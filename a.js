'use strict';
const net = require('net');
const dgram = require('dgram');
const http = require('http');

const argv = [...process.argv].slice(2);

const tcpPort = Number(argv[0]);
const udpPort = Number(argv[1]);
let password = argv[2] || '';

if (password.length === 0) {
	password = Math.random().toString(36).slice(2);
}/* else if (password.length < 20) {
	console.error('Password must contain at least 20 characters.');
	process.exit(1);
}*/

const names = Object.create(null);

const bufferPassword = Buffer.from(password);
const bufferPasswordLength = bufferPassword.length;

if (tcpPort !== 0) {
	if (!Number.isFinite(tcpPort) || tcpPort < 1000 || tcpPort >= 65535) {
		console.error('Invalid TCP port.');
		process.exit();
	}

	const tcpServer = net.createServer(socket => {
		socket.on('error', () => {});

		let timeout = setTimeout(() => {
			socket.destroy();
		}, 10000);

		socket.once('data', chunk => {
			if (!chunk.subarray(0, bufferPasswordLength).equals(bufferPassword)) {
				socket.destroy();
				return;
			}

			let address;
			if (socket.remoteFamily === 6) {
				address = `[${socket.remoteAddress}]:${socket.remotePort}`;
			} else {
				if (socket.remoteAddress.startsWith('::ffff:')) {
					address = `${socket.remoteAddress.slice(7)}:${socket.remotePort}`;
				} else {
					address = `${socket.remoteAddress}:${socket.remotePort}`;
				}
			}

			const name = chunk.subarray(bufferPasswordLength).toString();
			names[name] = address;

			clearTimeout(timeout);
			socket.write(`${socket.remoteAddress} ${socket.remotePort}`);
			socket.end();
		});
	}).listen(tcpPort);
}

if (udpPort !== 0) {
	if (!Number.isFinite(udpPort) || udpPort < 1000 || udpPort >= 65535) {
		console.error('Invalid UDP port.');
		process.exit();
	}

	const udpServer = dgram.createSocket('udp4');

	udpServer.on('message', (chunk, rinfo) => {
		if (!chunk.subarray(0, bufferPasswordLength).equals(bufferPassword)) {
			return;
		}

		let address;
		if (rinfo.family === 'IPv6') {
			address = `[${rinfo.address}]:${rinfo.port}`;
		} else {
			address = `${rinfo.address}:${rinfo.port}`;
		}

		const name = chunk.subarray(bufferPasswordLength).toString();
		names[name] = address;

		udpServer.send(`${rinfo.address} ${rinfo.port}`, rinfo.port, rinfo.address);
	});

	udpServer.bind(udpPort);
}

if (tcpPort === 0 && udpPort === 0) {
	console.error('Not listening.');
	process.exit();
}

const server = http.createServer((request, response) => {
	const name = request.url.slice(1);

	if (name in names) {
		response.end(names[name]);
	} else {
		response.statusCode = 404;
		response.end();
	}
}).listen(8999, () => {
	console.log(`TCP: ${tcpPort}`);
	console.log(`UDP: ${udpPort}`);
	console.log(`HTTP: ${server.address().port}`);
	console.log(`Password: ${password}`);
});
