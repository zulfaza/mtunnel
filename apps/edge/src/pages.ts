const STYLE = `:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui;background:#080b12;color:#f7f8fb}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 70% 15%,#12354a 0,transparent 35%),#080b12}main{max-width:980px;margin:auto;padding:11vh 28px}nav{display:flex;justify-content:space-between;align-items:center}.brand{font-weight:800;letter-spacing:-.04em;font-size:22px}.pill{border:1px solid #354052;border-radius:99px;padding:10px 16px;color:#fff;text-decoration:none}h1{font-size:clamp(50px,9vw,94px);line-height:.92;letter-spacing:-.065em;max-width:820px;margin:15vh 0 28px}p{color:#aeb9ca;font-size:19px;line-height:1.6;max-width:640px}.code{margin-top:42px;background:#111722;border:1px solid #293344;border-radius:14px;padding:18px 20px;font:15px ui-monospace,SFMono-Regular,monospace;color:#8de8c4;overflow:auto}.error{color:#ffb4a8}small{color:#718096}`;

function page(title: string, body: string, status: number = 200): Response {
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>${STYLE}</style><body>${body}</body></html>`,
    {
      status,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    },
  );
}

export function landingPage(): Response {
  return page(
    "Makarima — tunnels for local development",
    `<main><nav><div class="brand">makarima</div><a class="pill" href="https://github.com/zul/ztunnel">GitHub</a></nav><h1>Your localhost,<br>on the internet.</h1><p>Fast, encrypted development tunnels on Cloudflare. Sign in with Google from the CLI, then expose any local HTTP service in seconds.</p><div class="code">curl https://makarima.xyz/install.sh | sh<br>tunnel login<br>tunnel http 3000</div></main>`,
  );
}

export function errorPage(status: number, code: string, detail: string): Response {
  return page(
    `${status} — Makarima`,
    `<main><nav><div class="brand">makarima</div><a class="pill" href="https://makarima.xyz">Home</a></nav><h1 class="error">${status}</h1><p>${detail}</p><small>${code}</small></main>`,
    status,
  );
}

export function installScript(): Response {
  const script = `#!/bin/sh\nset -eu\nrepo=zul/ztunnel\nos=$(uname -s | tr '[:upper:]' '[:lower:]')\narch=$(uname -m)\ncase "$arch" in x86_64|amd64) arch=amd64;; arm64|aarch64) arch=arm64;; *) echo "unsupported architecture: $arch" >&2; exit 1;; esac\ncase "$os" in darwin|linux) ;; *) echo "unsupported OS: $os" >&2; exit 1;; esac\nasset="tunnel-$os-$arch.tar.gz"\ntmp=$(mktemp -d)\ntrap 'rm -rf "$tmp"' EXIT\ncurl -fsSL "https://github.com/$repo/releases/latest/download/$asset" -o "$tmp/tunnel.tar.gz"\ntar -xzf "$tmp/tunnel.tar.gz" -C "$tmp"\ndest="\${INSTALL_DIR:-$HOME/.local/bin}"\nmkdir -p "$dest"\ninstall -m 0755 "$tmp/tunnel" "$dest/tunnel"\necho "installed tunnel to $dest/tunnel"\n`;
  return new Response(script, {
    headers: {
      "content-type": "text/x-shellscript; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
