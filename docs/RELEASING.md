# Releasing

Releases are automated; maintainers should not edit versions or tags manually.

## Flow

1. Merge Conventional Commit pull requests into `main`.
2. Release Please creates or updates a release PR containing the next version and changelog.
3. Review and merge the release PR.
4. Release Please creates a `vX.Y.Z` tag and GitHub Release.
5. `publish.yml` verifies, builds, and publishes the exact tagged version to npm with provenance.

Version rules:

- `feat`: minor (`0.1.0` → `0.2.0`)
- `fix` or `perf`: patch (`0.1.0` → `0.1.1`)
- `docs`, `test`, `ci`, and `chore`: no release by themselves
- `!` or `BREAKING CHANGE:`: minor before 1.0, major after 1.0

## One-time npm setup

The package does not exist on npm yet, so bootstrap it once:

1. Create an npm granular access token with publish access to `oh-my-dm`.
2. Add it as the repository secret `NPM_TOKEN`.
3. Complete the first GitHub release through Release Please. `publish.yml` will publish the package using that token.
4. In the new npm package settings, add a GitHub Actions trusted publisher:
   - Organization or user: `stacking-money-forever`
   - Repository: `oh-my-dm`
   - Workflow: `publish.yml`
   - Environment: `npm`
   - Allowed action: `npm publish`
5. Delete the `NPM_TOKEN` repository secret. Every later release uses short-lived OIDC credentials.

The GitHub environment named `npm` already exists. Optional required reviewers can protect production publishing.

The workflow publishes only from a non-prerelease GitHub Release whose tag exactly matches `package.json`. It has no manual publish trigger and safely skips a version that already exists on npm. Trusted publishing uses OIDC and npm provenance, so no long-lived npm token remains after bootstrap.

## One-time GitHub release setup

Release Please needs permission to create a release pull request. Choose one option:

1. Enable **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests** at the organization/repository level; or
2. Add a repository secret named `RELEASE_PLEASE_TOKEN` containing a fine-grained PAT or GitHub App token scoped only to this repository with **Contents: write** and **Pull requests: write**.

The `stacking-money-forever` organization currently prevents the repository from enabling this permission locally, so option 2 is required unless an organization owner changes the organization policy. Until the secret exists, the release step is safely skipped with a warning. Never use or commit a classic token with unrelated organization access.

## Recovery

- Failed verification: fix the source through a pull request; never move an existing tag.
- GitHub Release exists but npm publish failed: fix the environment or trusted publisher and rerun the failed workflow.
- Version already exists on npm: do not overwrite it. Create a new fix commit and release.
- Compromised release: deprecate the npm version, publish a fixed version, and follow `SECURITY.md`.
