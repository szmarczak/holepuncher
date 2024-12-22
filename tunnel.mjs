// This does not work behind CGNAT nor Docker bridge NAT (you need access to host network card)!

import { once } from 'node:events';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import https from 'node:https';
import http from 'node:http';

// CloudFlare Tunnel to self
const tcpWebsite = new URL('https://...');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const args = process.argv.slice(2);

const tcp = [];
const udp = [];

for (const arg of args) {
	const type = arg.slice(0, 4);

	if (type === 'tcp/' || type === 'udp/') {
		const target = type === 'tcp/' ? tcp : udp;

		const slash = arg.indexOf('/', 4);

		const task = slash === -1 ? {
			port: arg.slice(4),
			name: arg,
		} : {
			port: arg.slice(4, slash),
			name: arg.slice(slash + 1),
		};

		const colon = task.port.indexOf(':');

		if (colon !== -1) {
			task.host = task.port.slice(0, colon);
			task.port = task.port.slice(colon + 1);
		} else {
			task.host = '127.0.0.1';
		}

		target.push(task);
	}
}

const proxyTcp = (from, task) => {
	const server = net.createServer({
		noDelay: true,
	}, source => {
		const target = net.connect({
			host: task.host,
			port: task.port,
			noDelay: true,
		});

		source.once('close', () => {
			target.resume();

			if (!target.writableEnded) {
				target.end();
			}
		});

		target.once('close', () => {
			source.resume();

			if (!source.writableEnded) {
				source.end();
			}
		});

		target.once('error', () => {
			source.resetAndDestroy();
		});

		source.once('error', () => {
			target.resetAndDestroy();
		});

		target.pipe(source);
		source.pipe(target);
	}).listen(from, () => {
		const connect = () => {
			let connected;

			const socket = net.connect(task.public.port, task.public.ip, () => {
				connected = true;

				socket.resetAndDestroy();
			});

			socket.once('error', error => {
				// console.error(`heartbeat failed: connected=${connected} ${error.code} ${task.public.ip}:${task.public.port}`);
			});
			socket.once('close', hadError => {
				if (hadError && !connected) {
					server.close();
					runTcpTask(task);
				} else {
					// console.error(`heartbeat ok: ${task.public.ip}:${task.public.port}`);

					setTimeout(() => {
						connect();
					}, 15000);
				}
			});
		};

		connect();
	});
};

const hole = async () => {
	const socket = net.connect({
		host: tcpWebsite.hostname,
		port: 443,
		family: 4,
		localPort: 0,
		noDelay: true,
	});

	socket.setTimeout(1000, () => {
		socket.resetAndDestroy();
	});

	const secure = tls.connect({
		socket,
		ALPNProtocols: ['http/1.1'],
		servername: tcpWebsite.hostname,
	});

	const request = https.request(tcpWebsite, { createConnection: () => secure });
	request.end();

	const [ response ] = await once(request, 'response');

	const { localPort } = response.req.socket;

	const chunks = [];
	for await (const chunk of response) {
		chunks.push(chunk);
	}

	request.once('error', () => {
		// No need to handle RST
	});

	// RST is required to skip TIME_WAIT
	socket.resetAndDestroy();

	if (!socket.closed) {
		await once(socket, 'close');
	}

	// Sleep to allow the kernel free the port
	console.log(`${new Date().toJSON()} Sleeping for 61s due to TIME_WAIT, port = ${localPort}`);
	await sleep(61_000);

	const body = Buffer.concat(chunks).toString();

	try {
		return [ localPort, JSON.parse(body) ];
	} catch {
		throw body;
	}
};

const runTcpTask = async task => {
	delete task.public;

	let localPort;
	do {
		try {
			const result = await hole();
			task.public = result[1];
			localPort = result[0];

			break;
		} catch (error) {
			if ('code' in error || String(error).startsWith('error code: ')) {
				await sleep(1000);
			} else {
				throw error;
			}
		}
	} while (true);

	proxyTcp(localPort, task);
};

const runUdpTask = task => {
	throw new Error('UDP holepunching is temporarily unsupported');
};

const server = http.createServer((request, response) => {
	const name = request.url.slice(1);

	for (const task of tcp) {
		if (task.name === name) {
			if (task.public === undefined) {
				response.end('null');
				return;
			}

			response.end(`${task.public.ip}:${task.public.port}`);
			return;
		}
	}

	response.end(JSON.stringify({
			ip: request.headers['cf-connecting-ip'],
			port: request.headers['x-client-port'],
	}, undefined, '\t'));
}).listen(80, async () => {
	console.log(tcpWebsite.origin);
	console.log('TCP services:', tcp);

	do {
		try {
			console.log('Checking connectivity...');
			await hole();
			console.log('OK!');
			break;
		} catch (error) {
			console.log(error);
			await sleep(1000);
		}
	} while (true);

	for (const task of tcp) {
		runTcpTask(task);
	}

	for (const task of udp) {
		runUdpTask(task);
	}
});
