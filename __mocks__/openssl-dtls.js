const EE = require('events');
const createServer = jest.fn(() => {
	const srv = new EE();
	srv.bind = jest.fn();
	srv.close = jest.fn();
	module.exports._createServer = srv;
	return srv;
});

const _socket = (PEER, CERT) => {
	const s = new EE();
	s.getCertChain = () => CERT;
	s.address = () => PEER;
	s.send = jest.fn();
	return s;
};

module.exports = { createServer, _socket };
