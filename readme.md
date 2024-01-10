## `holepuncher` 🌐

Ever wanted to share a project behind NAT? TCP? UDP? You name it.

> [!WARNING]
> **By no means this is production ready. Use at your own risk. This is a hobby project.**

### CloudFlare Tunnel

First, you need to create a tunnel using [CloudFlare Tunnels](https://one.dash.cloudflare.com/?to=/:account/access/tunnels) to `http://127.0.0.1:80` and mount the tunnel at your domain.

All what's left is to run the `tunnel.mjs` script.

> [!IMPORTANT]
> Remember to update the domain inside the script to match your domain.

Here's a simple `docker compose` configuration:

```yml
version: '3.9'

services:
  tunnel:
    image: node:21.5.0-alpine3.19
    volumes:
      - /home/alpine/tunnel.mjs:/tunnel.mjs
    command: node /tunnel.mjs tcp/127.0.0.1:25565/mc
    network_mode: host
  mc:
    image: eclipse-temurin:8-jre-alpine
    user: 1000:1000
    volumes:
      - /home/alpine/mc:/mc
    working_dir: /mc
    command: java -Xms12G -Xmx12G -jar /mc/forge-1.12.2-14.23.5.2860.jar
    network_mode: host
  cloudflared:
    restart: always
    image: cloudflare/cloudflared:latest
    command: tunnel --no-autoupdate run --token <TOKEN>
    network_mode: host

networks:
  tunnel:
```

Now start the services and you're good to go!

```bash
docker compose -f compose.yml up -d

curl https://tunnel.example.com/mc # 222.222.222.222:45678
```

> [!NOTE]
> The above is TCP-only. In order to punch a UDP hole, use the below.

<details>
<summary>Without CloudFlare Tunnel</summary>

### Server

Needs to be publicly accessible.

```bash
node a.js TCP_PORT UDP_PORT [PASSWORD]
```

This also starts up an HTTP server at `:8999`.

### Client

```bash
node b.js HOSTNAME TCP_PORT UDP_PORT PASSWORD [tcp/PORT[/NAME]] [udp/PORT[/NAME]]
```

If this command ends immediately, it failed. Make sure the credentials are correct.

### Usage

```bash
node a.js 8888 8888        # this will generate a random password
node a.js 8888 8888 secret # this will set a password

node b.js 111.111.111.111 8888 8888 secret tcp/8000 udp/8001 tcp/8002/cat udp/8003/dog

curl http://111.111.111.111:8999/tcp/8000 # 222.222.222.222:33333
curl http://111.111.111.111:8999/udp/8001 # 222.222.222.222:33334
curl http://111.111.111.111:8999/cat      # 222.222.222.222:33335
curl http://111.111.111.111:8999/dog      # 222.222.222.222:33336
```

</details>

### The HTTP server returned an address, but the connection failed.

> **This does not work behind [CGNAT](https://en.wikipedia.org/wiki/Carrier-grade_NAT).**

Most likely your NAT is restricted. Use a VPN instead.

### How does this work?

https://en.wikipedia.org/wiki/Hole_punching_(networking)

### I'm getting empty connections / messages every 15s.

Those are used to keep the port mappings alive.\
Otherwise the address would change every 60 seconds or so.

Please note that UDP does not have the concept of connections.\
Therefore this program maintains its own mappings for UDP sockets.

### Can share SSH?

No. `fail2ban` will fail because your server sees the packets as coming from `::1`.

```
                                       |------| What's my IP and port?  |------|
                                       | b.js | ----------------------> | a.js |
                                       |------|                         |------|

                                       |------|  222.222.222.222:33333  |------|
                                       | b.js | <---------------------- | a.js |
                                       |------|                         |------|

                                         ::1
    |--------|                         |------|                         |----------|
    | server | <---------------------> | b.js | <---------------------> | internet |
    |--------|                         |------|                         |----------|
The thing you want to share.          holepuncher                          anyone
```

### Want to learn more?

Read the source code :)

### License

MIT
