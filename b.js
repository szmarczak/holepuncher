'use strict';
const net = require('net');
const dgram = require('dgram');

const argv = [...process.argv].slice(2);

const address = argv[0];
const tcpPort = Number(argv[1]);
const udpPort = Number(argv[2]);
let password = argv[3] || '';

if (password.length === 0) {
	console.error('Missing password.');
	process.exit(1);
}

const tcp = [];
const udp = [];

let slash;
for (const arg of argv.slice(4)) {
	const type = arg.slice(0, 4);

	if (type === 'tcp/' || type === 'udp/') {
		const target = type === 'tcp/' ? tcp : udp;

		slash = arg.indexOf('/', 4);

		if (slash === -1) {
			target.push({
				port: arg.slice(4),
				name: arg
			});
		} else {
			target.push({
				port: arg.slice(4, slash),
				name: arg.slice(slash + 1)
			});
		}
	}
}

const proxyTcp = (from, to, task) => {
	let closeTimeout;
	let abortClose = () => {};

	const check = () => {
		let aborted = false;

		// TODO: confirm if there is a race condition
		server.getConnections((error, count) => {
			if (error) {
				console.error(error);
				return;
			}

			if (aborted) {
				return;
			}

			if (count === 0 && closeTimeout === undefined) {
				closeTimeout = setTimeout(() => {
					server.close();
				}, 20000);
			}
		});

		return () => {
			if (aborted) {
				return;
			}

			aborted = true;
			clearTimeout(closeTimeout);
			closeTimeout = undefined;
		};
	};

	const server = net.createServer(source => {
		abortClose();

		const target = net.connect(to);

		source.once('close', () => {
			target.resume();

			if (!target.writableEnded) {
				target.end();
			}

			abortClose = check();
		});

		target.once('close', () => {
			source.resume();

			if (!source.writableEnded) {
				source.end();
			}
		});

		target.once('error', () => {
			source.destroy();
		});

		source.once('error', () => {
			target.destroy();
		});

		target.pipe(source);
		source.pipe(target);
	}).listen(from, () => {
		if (!task.public) {
			return;
		}

		const connect = () => {
			const socket = net.connect(task.public.port, task.public.address, () => {
				socket.end();
			});

			socket.once('error', () => {
				// console.error(`heartbeat failed: ${task.public.port} ${task.public.address}`);
			});
			socket.once('close', hadError => {
				if (!hadError) {
					// console.error(`heartbeat ok: ${task.public.port} ${task.public.address}`);

					setTimeout(() => {
						connect();
					}, 15000);
				}
			});
		};

		connect();
	});

	server.once('close', () => {
		runTcpTask(task);
	});

	abortClose = check();
};

const runTcpTask = task => {
	delete task.public;

	let localPort;
	const socket = net.connect(tcpPort, address, () => {
		localPort = socket.localPort;

		socket.write(`${password}${task.name}`);
	});

	socket.once('error', error => {
		console.error(error.message);

		setTimeout(() => {
			runTcpTask(task);
		}, 60000);
	});

	// Heartbeat
	socket.once('data', chunk => {
		const addressWithPort = chunk.toString();
		const colon = addressWithPort.lastIndexOf(' ');
		const publicAddress = addressWithPort.slice(0, colon);
		const port = addressWithPort.slice(colon + 1);

		task.public = {address: publicAddress, port};

		socket.end();
	});

	socket.once('close', hadError => {
		if (!hadError) {
			setTimeout(() => {
				proxyTcp(localPort, task.port, task);
			}, 1000);
		}
	});

	socket.setTimeout(60000, () => {
		socket.destroy();
	});
};

const runUdpTask = task => {
	delete task.public;

	let timeouts = {};
	let mappings = {};
	const send = (chunk, rinfoSrc) => {
		const key = `${rinfoSrc.address} ${rinfoSrc.port}`;

		if (!mappings[key]) {
			const socket = dgram.createSocket('udp4');
			socket.bind(0);

			socket.on('message', (chunk, rinfo) => {
				socket.send(chunk, 0, rinfo.size, rinfoSrc.port, rinfoSrc.address, error => {
					if (error) {
						socket.close();
					}
				});

				clearTimeout(timeouts[key]);
				timeouts[key] = setTimeout(() => {
					socket.close();
				}, 60000);
			});

			socket.once('close', () => {
				clearTimeout(timeouts[key]);

				delete mappings[key];
				delete timeouts[key];
			});

			mappings[key] = socket;
		}

		const socket = mappings[key];
		socket.send(chunk, 0, rinfoSrc.size, task.port);

		clearTimeout(timeouts[key]);
		timeouts[key] = setTimeout(() => {
			socket.close();
		}, 60000);
	};

	const client = dgram.createSocket('udp4');
	client.bind(0);

	client.once('close', () => {
		runUdpTask(task);
	});

	let serverTimeout = setTimeout(() => {
		client.close();
	}, 20000);

	let punched = false;

	const onMessage = chunk => {
		punched = true;

		const addressWithPort = chunk.toString();
		const colon = addressWithPort.lastIndexOf(' ');
		const publicAddress = addressWithPort.slice(0, colon);
		const port = addressWithPort.slice(colon + 1);

		task.public = {address: publicAddress, port};

		client.on('message', (chunk, rinfo) => {
			send(chunk, rinfo);

			clearTimeout(serverTimeout);
			serverTimeout = setTimeout(() => {
				client.close();
			}, 20000);
		});

		// Heartbeat
		const heartbeat = dgram.createSocket('udp4');
		heartbeat.bind(0);

		const interval = setInterval(() => {
			heartbeat.send('', 0, 0, port, publicAddress, error => {
				if (error) {
					heartbeat.close();
				}
			});
		}, 15000);

		heartbeat.once('close', () => {
			clearInterval(interval);
		});
	};

	client.once('message', onMessage);

	client.send(`${password}${task.name}`, udpPort, address, error => {
		if (error) {
			console.error(error);
		}
	});

	setTimeout(() => {
		if (!punched) {
			client.off('message', onMessage);
			console.error('UDP timed out.');

			runUdpTask(task);
		}
	}, 60000);
};

for (const task of tcp) {
	runTcpTask(task);
}

for (const task of udp) {
	runUdpTask(task);
}
