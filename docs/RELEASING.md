# Releasing

Releases are automated; maintainers should not edit versions or tags manually.

## Flow

1. Merge Conventional Commit pull requests into `main`.
2. Release Please creates or updates a release PR containing the next version and changelog.
3. Review and merge the release PR.
4. Release Please creates a `vX.Y.Z` tag and GitHub Release.
5. `publish.yml` verifies, builds, and publishes the exact tagged version to npm with provenance.

`feat` creates a minor release, `fix` and `perf` create a patch release, and a breaking change creates a major release. Before 1.0, the Release Please configuration keeps breaking feature work within pre-1.0 versioning.

## One-time npm setup

1. Create or claim the public `oh-my-dm` package on npm.
2. In npm package settings, add a GitHub Actions trusted publisher:
   - Organization or user: `stacking-money-forever`
   - Repository: `oh-my-dm`
   - Workflow: `publish.yml`
   - Environment: `npm`
3. In GitHub repository settings, create an environment named `npm`. Optional required reviewers can protect production publishing.

The workflow uses OIDC and npm provenance, so a long-lived `NPM_TOKEN` is not stored in GitHub. If trusted publishing is unavailable, add an `NPM_TOKEN` secret and explicitly pass it as `NODE_AUTH_TOKEN`; do not commit tokens.

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
