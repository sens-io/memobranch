# Publishing to npm

Run from a source checkout with Node.js 20+, Git and npm. The release command is a maintainer tool, not part of the installed package. It targets only the public npm registry and requires the `sens-io` account for actual publication.

1. Update the version with `npm version minor --no-git-tag-version` (or `patch`), update both README version references and release notes, then commit the release candidate. Review that committed candidate before publishing. The working tree must be clean, including untracked files.
2. Log in with `npm login --registry=https://registry.npmjs.org` if necessary.
3. One-command release: `npm run release -- --publish`.

`npm run release` (or `npm run release -- --dry-run`) runs all gates without uploading. Both modes install locked dependencies with `npm ci`, build and run the complete regression suite, audit production dependencies, validate OpenSpec, pack once, and install/smoke-test that exact tarball. Actual publication checks the signed-in account, rejects existing versions and stable downgrades, uploads the verified artifact, then compares registry integrity and the `latest` tag. Pre-release versions are deliberately unsupported by this stable-release script.

npm may ask for browser/2FA verification; complete it yourself in the trusted npm flow. No credentials are stored by the script. Validation requires network access and permission to bind loopback test servers. The script does not push Git, create tags, or release on GitHub.

If publication fails or registry verification is delayed, **do not blindly retry**. Inspect `npm view memobranch@VERSION dist.integrity` and `npm view memobranch dist-tags` first. Published versions are immutable. A corrective release needs a new version; changing source or a Git revert does not roll back an npm publication.

## 1.1.0

- Bundled local, authenticated Web management console (`memobranch web`).
- Memory/evidence management, candidate review, Wiki workflows, settings and operations.
- Token authentication, loopback-only binding, permission checks and cancellation boundaries.
- Safe maintainer release automation with exact-tarball installation verification.

## 中文速查

维护者在源码目录中更新版本和双语 README、提交并审查后，执行 `npm run release -- --publish` 即可完成验证和发布。不加参数默认只预演。脚本不会自动推送 Git、创建标签或存储凭据；需要 npm 验证时请本人完成。发布结果不确定时先查 npm，禁止盲目重试。
