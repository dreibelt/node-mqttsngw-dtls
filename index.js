const DTLS = require('openssl-dtls');
const mqttsn = require('mqttsn-packet');

module.exports = (opts) => (bus) => new Promise((resolve) => {
	// Create new DTLS server context
	const srv = DTLS.createServer(opts);

	// Debug log incoming handshakes
	if (opts.log && opts.log.debug) {
		srv.on('connection', (peer) => opts.log.debug(
			`Handshake started by [${peer.address}]:${peer.port}`,
			{
				message_id: 'c266859e94db40edbf126f74634dd5fc',
				clientKey: `${peer.address}_${peer.port}`
			}
		));
	}

	// Warn log DTLS errors caused by clients
	if (opts.log && opts.log.warn) {
		srv.on('error', (err, peer) => opts.log.warn(
			`Error caused by [${peer.address}]:${peer.port}: ${err.message}`,
			{
				message_id: 'c62a326b9eae447c862d139a5972f92c',
				clientKey: `${peer.address}_${peer.port}`
			}
		));
	}

	// React to incoming connections
	srv.on('secureConnection', (socket) => {
		const peer = socket.address();
		const clientKey = `${peer.address}_${peer.port}`;

		// Parse incoming packets
		const parser = mqttsn.parser();
		socket.on('message', (msg) => parser.parse(msg));
		parser.on('packet', (packet) => {
			packet.clientKey = clientKey;
			const consumed = bus.emit(['snUnicastIngress', clientKey, packet.cmd], packet);
			if (!consumed && opts.log && opts.log.error) {
				opts.log.error('Unconsumed MQTTSN packet', Object.assign({
					message_id: '9cf60d7aa0eb4b3f976f25671eea1ff5',
					clientKey: clientKey
				}, packet));
			}
		});

		// Listen for outgress packets on the bus
		const outgressHandler = (packet) => {
			try {
				packet = mqttsn.generate(packet);
				socket.send(packet);
			} catch (err) {
				if (opts.log && opts.log.error) {
					opts.log.error(`Generator error: ${err.message}`, Object.assign({
						message_id: 'c05700ab021d47ddbd3ab914e2eef334',
						stack: err.stack,
						clientKey: clientKey
					}, packet));
				}
			}
		};
		const outgressEvent = ['snUnicastOutgress', clientKey, '*'];
		bus.on(outgressEvent, outgressHandler);
		socket.on('close', () => bus.removeListener(outgressEvent, outgressHandler));

		// Install logging handlers
		if (opts.log && opts.log.debug) {
			opts.log.debug(`Handshake successfully finished with [${peer.address}]:${peer.port}`, {
				message_id: '1d223f68a881407d86b94babf40da157',
				clientKey: clientKey
			});
			socket.on('close', () => opts.log.debug(
				`Connection to [${peer.address}]:${peer.port} closed`,
				{
					message_id: '0664446f18574088b369460de3aa197b',
					clientKey: clientKey
				}
			));
		}
		if (opts.log && opts.log.warn) {
			parser.on('error', (err) => opts.log.warn(
				`Parser error: ${err.message}`,
				{
					message_id: 'fed465ee771a4701ad119f1fda70972a',
					stack: err.stack,
					clientKey: clientKey
				}
			));
		} else {
			// Dummy listener: We don't want to crash everything
			// due to unhandler parsing errors.
			parser.on('error', () => {});
		}
	});

	// Expose start and stop handler
	const stop = () => {
		// TODO
	};
	const start = () => {
		srv.bind(opts.bind);
		return stop;
	};
	resolve(start);
});
