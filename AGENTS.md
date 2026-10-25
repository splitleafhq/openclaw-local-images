# AGENTS.md

Rules for working in this repo.

1. Send requests only to a loopback `baseUrl`; any other host leaves the provider unconfigured, so prompts and images never leave the machine through this plugin.
2. Keep the server contract in `docs/server-api.md` the single source for the request and response shapes; change it and the code together.
3. Don't judge or rewrite prompts; what gets generated is the operator's and the agent's call.
4. Hard-code no model id, weights or agent id; models come from config.
5. Follow OpenClaw's own conventions for names (camelCase keys, unit suffixes); where none exists, leave the setting unset rather than invent a default.
6. Keep everything setup-agnostic: no agent names, hostnames, paths, chat ids or model choices from any real setup, in code, tests, docs, commits, issues or pull requests.
7. Build fixtures from synthetic content, never from real prompts or images.
8. Ship a fix with a test you have watched fail without it.
9. Name a test for the failure it prevents.
10. Cite the OpenClaw version, and a docs page or source file, for any claim about OpenClaw behaviour, and label anything not yet checked on a live gateway as unverified in `docs/verification.md`.
11. Pin every tool and action to an exact version or commit.
12. Keep runtime dependencies at zero; import only `node:` built-ins and `openclaw/plugin-sdk/*`.
13. A comment states a constraint the code can't show, never what the next line does.
14. Write terse, factual prose.
15. Commit and open pull requests on the user's behalf; pushing, merging, tagging and releasing each need their own approval.
16. Keep agent-session links and session trailers out of commit messages, issues and pull request bodies.
