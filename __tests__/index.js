jest.mock('openssl-dtls');
const DTLS = require('openssl-dtls');

jest.mock('mqttsn-packet');
const mqttsn = require('mqttsn-packet');

const dtls = require('../index.js');

const bus = {
	on: jest.fn(),
	emit: jest.fn(() => true),
	removeListener: jest.fn()
};

test('reject if creating DTLS socket failed', () => {
	const ERR = new Error();
	DTLS.createServer.mockImplementationOnce(() => { throw ERR; });
	return dtls({})(bus)
		.then(() => Promise.reject(new Error('FAILED')))
		.catch((e) => {
			expect(e).toBe(ERR);
		});
});

test('call bind method on start call', () => {
	const bind = {};
	return dtls({ bind })({}).then((start) => start()).then(() => {
		expect(DTLS._createServer.bind.mock.calls[0][0]).toBe(bind);
	});
});

test('debug log incoming handshakes', () => {
	const PEER = {
		address: '::1',
		port: 12345
	};
	const debug = jest.fn();
	dtls({ log: { debug } })(bus);
	DTLS._createServer.emit('connection', PEER);
	expect(debug.mock.calls[0][0]).toEqual('Handshake started by [::1]:12345');
	expect(debug.mock.calls[0][1]).toMatchObject({
		message_id: 'c266859e94db40edbf126f74634dd5fc',
		clientKey: `${PEER.address}_${PEER.port}`
	});
});

test('warn log errors caused by peers', () => {
	const PEER = {
		address: '::1',
		port: 12345
	};
	const ERR = new Error('testErr');
	const warn = jest.fn();
	dtls({ log: { warn } })(bus);
	DTLS._createServer.emit('error', ERR, PEER);
	expect(warn.mock.calls[0][0]).toEqual('Error caused by [::1]:12345: testErr');
	expect(warn.mock.calls[0][1]).toMatchObject({
		message_id: 'c62a326b9eae447c862d139a5972f92c',
		clientKey: `${PEER.address}_${PEER.port}`
	});
});

test('debug log established connections', () => {
	const SOCKET = DTLS._socket({
		address: '::1',
		port: 12345
	});
	const debug = jest.fn();
	dtls({ log: { debug } })(bus);
	DTLS._createServer.emit('secureConnection', SOCKET);
	expect(debug.mock.calls[0][0]).toEqual('Handshake successfully finished with [::1]:12345');
	expect(debug.mock.calls[0][1]).toMatchObject({
		message_id: '1d223f68a881407d86b94babf40da157',
		clientKey: '::1_12345'
	});
});

test('debug log closed connections', () => {
	const SOCKET = DTLS._socket({
		address: '::1',
		port: 12345
	});
	const debug = jest.fn();
	dtls({ log: { debug } })(bus);
	DTLS._createServer.emit('secureConnection', SOCKET);
	SOCKET.emit('close');
	expect(debug.mock.calls[1][0]).toEqual('Connection to [::1]:12345 closed');
	expect(debug.mock.calls[1][1]).toMatchObject({
		message_id: '0664446f18574088b369460de3aa197b',
		clientKey: '::1_12345'
	});
});

test('parse incoming messages', () => {
	const BUFFER = Buffer.alloc(0);
	const SOCKET = DTLS._socket({
		address: '::1',
		port: 12345
	});
	dtls({})(bus);
	DTLS._createServer.emit('secureConnection', SOCKET);
	SOCKET.emit('message', BUFFER);
	expect(mqttsn._parser.parse.mock.calls[0][0]).toBe(BUFFER);
});

test('warn log parser errors', () => {
	const ERROR = new Error('testErr');
	const SOCKET = DTLS._socket({
		address: '::1',
		port: 12345
	});
	const warn = jest.fn();
	dtls({ log: { warn } })(bus);
	DTLS._createServer.emit('secureConnection', SOCKET);
	mqttsn._parser.emit('error', ERROR);
	expect(warn.mock.calls[0][0]).toEqual('Parser error: testErr');
	expect(warn.mock.calls[0][1]).toMatchObject({
		message_id: 'fed465ee771a4701ad119f1fda70972a',
		clientKey: '::1_12345'
	});
});

test('emit parsed packets to bus', () => {
	const PACKET = {
		cmd: 'testCmd'
	};
	const SOCKET = DTLS._socket({
		address: '::1',
		port: 12345
	});
	dtls({})(bus);
	DTLS._createServer.emit('secureConnection', SOCKET);
	mqttsn._parser.emit('packet', PACKET);
	expect(bus.emit.mock.calls[0][0]).toMatchObject([
		'snUnicastIngress',
		'::1_12345',
		'testCmd'
	]);
	expect(bus.emit.mock.calls[0][1]).toMatchObject(Object.assign({
		clientKey: '::1_12345'
	}, PACKET));
});

test('error log if emitted bus events are not consumed', () => {
	const PACKET = {
		cmd: 'testCmd'
	};
	const SOCKET = DTLS._socket({
		address: '::1',
		port: 12345
	});
	const error = jest.fn();
	dtls({ log: { error } })(bus);
	bus.emit.mockReturnValueOnce(false);
	DTLS._createServer.emit('secureConnection', SOCKET);
	mqttsn._parser.emit('packet', PACKET);
	expect(error.mock.calls[0][0]).toEqual('Unconsumed MQTTSN packet');
	expect(error.mock.calls[0][1]).toMatchObject({
		message_id: '9cf60d7aa0eb4b3f976f25671eea1ff5',
		clientKey: '::1_12345',
		cmd: 'testCmd'
	});
});

test('listen for outgress packets on the bus', () => {
	const SOCKET = DTLS._socket({
		address: '::1',
		port: 12345
	});
	dtls({})(bus);
	DTLS._createServer.emit('secureConnection', SOCKET);
	expect(bus.on.mock.calls[0][0]).toMatchObject([
		'snUnicastOutgress',
		'::1_12345',
		'*'
	]);
});

test('convert outgress packets to buffer and transmit them', () => {
	const PACKET = {};
	const BUFFER = {};
	const SOCKET = DTLS._socket({
		address: '::1',
		port: 12345
	});
	dtls({})(bus);
	DTLS._createServer.emit('secureConnection', SOCKET);
	mqttsn.generate.mockReturnValueOnce(BUFFER);
	bus.on.mock.calls[0][1](PACKET);
	expect(mqttsn.generate.mock.calls[0][0]).toBe(PACKET);
	expect(SOCKET.send.mock.calls[0][0]).toBe(BUFFER);
});

test('error log non-convertable outgress packets', () => {
	const PACKET = {
		test: 1234
	};
	const SOCKET = DTLS._socket({
		address: '::1',
		port: 12345
	});
	const error = jest.fn();
	dtls({ log: { error } })(bus);
	DTLS._createServer.emit('secureConnection', SOCKET);
	mqttsn.generate.mockImplementationOnce(() => {
		throw new Error('testErr');
	});
	bus.on.mock.calls[0][1](PACKET);
	expect(error.mock.calls[0][0]).toEqual('Generator error: testErr');
	expect(error.mock.calls[0][1]).toMatchObject(Object.assign({
		message_id: 'c05700ab021d47ddbd3ab914e2eef334',
		clientKey: '::1_12345'
	}, PACKET));
});

test('remove listener for outgress packets on the bus on disconnect', () => {
	const SOCKET = DTLS._socket({
		address: '::1',
		port: 12345
	});
	dtls({})(bus);
	DTLS._createServer.emit('secureConnection', SOCKET);
	SOCKET.emit('close');
	expect(bus.removeListener.mock.calls[0][0]).toMatchObject([
		'snUnicastOutgress',
		'::1_12345',
		'*'
	]);
});
