# Third-party components

The [Zero-Clause BSD (0BSD) license](LICENSE) covers this repository's original
code and documentation. Commercial use, modification and redistribution are
permitted; attribution to this project's authors is optional. This grant does
not replace the licenses of third-party components.

Adobe Premiere Pro, Creative Cloud, UXP Developer Tool and Adobe SDKs are
separate products under Adobe's terms; this package neither includes nor
licenses them.

Setup downloads an official Node.js archive with a pinned SHA-256. Its license
and notices remain in the extracted archive. npm dependencies are installed
from `package-lock.json`; each dependency retains its own license and notices.
This includes the installer TOML parser `smol-toml` (BSD-3-Clause), the Model
Context Protocol SDK, Zod and ws (MIT), and the development/build toolchain.
When redistributing installed dependencies or compiled products containing
them, retain the notices and meet the terms required by those components.
CEP helper setup downloads Adobe's ZXPSignCmd from Adobe-CEP/CEP-Resources
and verifies platform-specific pinned hashes. The track-lock installer also uses
Adobe's macOS Intel signer (Rosetta required on Apple Silicon). These binaries
and Adobe SDK headers are not included in the source release.

FFmpeg and segmentation models are optional external tools, are not included
in the source release, and have separate licenses. If redistributing them, comply
with the license and source-distribution requirements of the specific build.

Installation design references (no copied implementation):

- [CaYatur/PremiereProMCP Setup.ps1](https://github.com/CaYatur/PremiereProMCP/blob/fe105a1640e6b6a487e2a3918c80c09fa44dd975/installer/Setup.ps1): portable runtime and installation-local MCP paths.
- [leancoderkavy/premiere-pro-mcp distribution](https://github.com/leancoderkavy/premiere-pro-mcp/blob/f610059a765c9cfc659b818c8c23b7c4995af978/uxp-plugin/DISTRIBUTION.md): direct CCX distribution.
- [Adobe plugin installation](https://developer.adobe.com/premiere-pro/uxp/plugins/distribution/install/) and [packaging](https://developer.adobe.com/premiere-pro/uxp/plugins/distribution/package/): official UPIA/CCX entry points and consent.
