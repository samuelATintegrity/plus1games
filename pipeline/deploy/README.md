# deploy

Deployment is automatic. Cloudflare Pages is connected to the GitHub repo and:
- Builds and publishes `site/` on every push to `main`
- Creates a preview URL for every PR (this is how you review games before they go live)

There is no script here. To deploy, merge a PR to main.

To set this up the first time, see the **Cloudflare Pages** section in the root `README.md`.
