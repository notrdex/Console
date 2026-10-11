# Render Ubuntu Web Terminal (prototype)

This is an authenticated browser-terminal prototype. It is **not** a full VPS host. It runs commands as an unprivileged user inside one Render service container.

## Before deploying
- Use a strong, unique password and keep the app private to people you trust.
- Render free web services do not provide dashboard Shell/SSH access, and the default filesystem is ephemeral. Persistent disks require an eligible paid service.
- Do not expect Docker-in-Docker, LXD, KVM, or nested virtualization to work on ordinary Render web services. The capability page only checks device/socket visibility; it cannot grant host privileges.
- A web terminal is powerful. Never publish it without authentication and HTTPS.

## 1. Create repository
Upload these files to the root of a new GitHub repository:
`Dockerfile`, `package.json`, `server.js`, `index.html`, `.gitignore`, `README.md`.

## 2. Generate a bcrypt password hash
Run locally on a trusted computer with Node.js:
```bash
npm install bcryptjs
node -e "const b=require('bcryptjs'); console.log(b.hashSync(process.argv[1], 12))" 'YOUR_LONG_UNIQUE_PASSWORD'
```
Copy the resulting `$2a$...` hash. Do not put the plain password in the repository.

Generate a long random session secret, for example:
```bash
openssl rand -hex 32
```

## 3. Deploy on Render
1. Render Dashboard → **New** → **Web Service** → connect your repository.
2. Choose **Docker** runtime.
3. Keep Dockerfile path as `./Dockerfile`.
4. Add environment variables:
   - `TERMINAL_USERNAME` = your chosen username
   - `TERMINAL_PASSWORD_HASH` = bcrypt hash from step 2
   - `SESSION_SECRET` = output from `openssl rand -hex 32`
   - `DATA_DIR` = `/data`
5. Create the service and wait for deployment.
6. Open its `onrender.com` URL. Sign in and run basic commands like `id`, `pwd`, `uname -a`, and `ls -la /data`.
7. Click **Check QEMU / LXD / Docker capability**.

## 4. Persistent files
The app uses `/data` as its working directory. On an eligible paid Render service, add a persistent disk with mount path `/data`. Only files stored under that mount path persist. Without a disk, data may be lost on restart/redeploy. A persistent disk does not provide VM host privileges.

## 5. What the capability test means
- `/dev/kvm` present: KVM device is visible, not proof that it is usable.
- Docker socket present: socket is visible, not proof that the daemon accepts requests.
- LXD requires daemon/socket and host kernel features; installing `lxd-client` alone is not enough.
- QEMU may run in software emulation but can be slow and still be blocked by host resource limits.
- This container deliberately runs as `nobody` and does not start a privileged Docker daemon or LXD daemon.

## Troubleshooting
- Service exits at startup: confirm all three required environment variables exist and `SESSION_SECRET` has 32+ characters.
- `node-pty` build fails: check Render build logs; native modules require compatible build tooling/architecture.
- Login fails: regenerate the bcrypt hash for the exact password and update the environment variable.
- Terminal won't connect: check browser console and Render logs. Ensure the service URL is HTTPS.
- Need real VMs with root SSH: use a VM host that explicitly supports KVM/nested virtualization and privileged container management; ordinary Render web services are not designed as VM hosts.

## Security
This is a prototype, not a multi-user sandbox. Every authenticated user shares the same OS user and filesystem. Do not give access to untrusted users, and do not use it for sensitive workloads.
