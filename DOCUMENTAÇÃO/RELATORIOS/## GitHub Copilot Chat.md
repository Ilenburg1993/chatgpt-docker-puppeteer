## GitHub Copilot Chat

- Extension: 0.37.8 (prod)
- VS Code: 1.109.5 (072586267e68ece9a47aa43f8c108e0dcbf44622)
- OS: linux 6.6.87.2-microsoft-standard-WSL2 x64
- Remote Name: dev-container
- Extension Kind: Workspace
- GitHub Account: Ilenburg1993

## Network

**Note:** the following connection tests may show IPv6 lookup errors when running under WSL2, which
are harmless.

**User settings:**

```json
  "http.systemCertificatesNode": true,
  "github.copilot.advanced.debug.useElectronFetcher": true,
  "github.copilot.advanced.debug.useNodeFetcher": false,
  "github.copilot.advanced.debug.useNodeFetchFetcher": true
```

Connecting to https://api.github.com:

- DNS ipv4 Lookup: 4.228.31.149 (6 ms)
- DNS ipv6 Lookup: Error (60 ms): getaddrinfo ENOTFOUND api.github.com
- Proxy URL: None (1 ms)
- Electron fetch: Unavailable
- Node.js https: HTTP 200 (136 ms)
- Node.js fetch (configured): HTTP 200 (174 ms)

Connecting to https://api.individual.githubcopilot.com/_ping:

- DNS ipv4 Lookup: 140.82.114.22 (87 ms)
- DNS ipv6 Lookup: Error (100 ms): getaddrinfo ENOTFOUND api.individual.githubcopilot.com
- Proxy URL: None (1 ms)
- Electron fetch: Unavailable
- Node.js https: HTTP 200 (815 ms)
- Node.js fetch (configured): HTTP 200 (693 ms)

Connecting to https://proxy.individual.githubcopilot.com/_ping:

- DNS ipv4 Lookup: 4.228.31.153 (49 ms)
- DNS ipv6 Lookup: Error (67 ms): getaddrinfo ENOTFOUND proxy.individual.githubcopilot.com
- Proxy URL: None (0 ms)
- Electron fetch: Unavailable
- Node.js https: HTTP 200 (143 ms)
- Node.js fetch (configured): HTTP 200 (139 ms)

Connecting to https://mobile.events.data.microsoft.com: HTTP 404 (1281 ms) Connecting to
https://dc.services.visualstudio.com: HTTP 404 (1347 ms) Connecting to
https://copilot-telemetry.githubusercontent.com/_ping: HTTP 200 (801 ms) Connecting to
https://telemetry.individual.githubcopilot.com/_ping: HTTP 200 (911 ms) Connecting to
https://default.exp-tas.com: HTTP 400 (272 ms)

Number of system certificates: 414

## Documentation

In corporate networks:
[Troubleshooting firewall settings for GitHub Copilot](https://docs.github.com/en/copilot/troubleshooting-github-copilot/troubleshooting-firewall-settings-for-github-copilot).
