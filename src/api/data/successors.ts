/**
 * "What works instead" for MCP servers that are archived or abandoned.
 *
 * Every row was found and then independently re-checked on 2026-11-20 from
 * the vendor's or maintainer's own pages (evidence URLs are kept per row).
 * Kinds: official = run by the vendor of the underlying service; declared =
 * named by the abandoned project's own maintainers; fork = a community
 * continuation of the same code; alternative = a different project doing the
 * same job. A wrong successor is worse than none, so rows with no successor
 * we could stand behind say so instead of guessing.
 *
 * Refresh: re-verify each row at least every 90 days (CHECKED_AT below).
 */

export const SUCCESSORS_CHECKED_AT = "2026-11-20";

export type ReplacementKind = "official" | "declared" | "fork" | "alternative";
export type Replacement = {
  name: string;
  kind: ReplacementKind;
  /** registry:name, e.g. "npm:@brave/brave-search-mcp-server" or "oci:ghcr.io/…". */
  package?: string;
  remoteUrl?: string;
  how: string;
  credentials: string;
  evidence: string[];
  maintained: string;
};
export type AbandonedServer = {
  id: string;
  server: string;
  status: "archived" | "stale";
  summary: string;
  statusEvidence: string;
  packages: { registry: "npm" | "pypi" | "docker"; name: string; latestVersion?: string; weeklyDownloads?: number; deprecatedNotice?: string }[];
  replacements: Replacement[];
  note?: string;
};

export const KIND_LABEL: Record<ReplacementKind, string> = {
  official: "Official — run by the vendor",
  declared: "Named by its maintainers",
  fork: "Maintained fork",
  alternative: "Alternative",
};

export const ABANDONED_SERVERS: AbandonedServer[] = [
  {
    "id": "github",
    "server": "GitHub",
    "status": "archived",
    "summary": "Archived by the MCP maintainers on 2025-05-29; every npm version is deprecated.",
    "statusEvidence": "https://github.com/modelcontextprotocol/servers-archived",
    "packages": [
      {
        "registry": "npm",
        "name": "@modelcontextprotocol/server-github",
        "latestVersion": "2025.4.8",
        "weeklyDownloads": 112028,
        "deprecatedNotice": "Archived and unmaintained; no security guarantees. See https://github.com/modelcontextprotocol/servers-archived"
      },
      {
        "registry": "docker",
        "name": "mcp/github"
      }
    ],
    "replacements": [
      {
        "name": "GitHub MCP Server (github/github-mcp-server)",
        "kind": "official",
        "package": "oci:ghcr.io/github/github-mcp-server",
        "remoteUrl": "https://api.githubcopilot.com/mcp/",
        "how": "Remote: add https://api.githubcopilot.com/mcp/ as an HTTP server and sign in with OAuth (the host must support it) or send 'Authorization: Bearer <GitHub PAT>'. Local: claude mcp add github -e GITHUB_PERSONAL_ACCESS_TOKEN=$GITHUB_PAT -- docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server",
        "credentials": "Either a GitHub OAuth login (the remote server needs a host with OAuth support; the official Docker image logs in through the browser on github.com) or a GitHub personal access token with only the scopes you choose to grant. GitHub Enterprise Server and ghe.com need your own OAuth or GitHub App. GitHub Enterprise Server has no hosted remote; run the image locally with a PAT there.",
        "evidence": [
          "https://raw.githubusercontent.com/modelcontextprotocol/servers-archived/main/src/github/README.md",
          "https://raw.githubusercontent.com/github/github-mcp-server/main/README.md",
          "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.github/github-mcp-server&version=latest"
        ],
        "maintained": "Release 'GitHub MCP Server 2.2.0' published 2026-11-16 and marked Latest (https://github.com/github/github-mcp-server/releases/tag/v2.2.0). Default branch HEAD committed 2026-11-20. The MCP registry lists io.github.github/github-mcp-server…"
      }
    ],
    "note": "The official server has a different, larger toolset; tool names change when you switch."
  },
  {
    "id": "gitlab",
    "server": "GitLab",
    "status": "archived",
    "summary": "Archived by the MCP maintainers on 2025-05-29; every npm version is deprecated.",
    "statusEvidence": "https://github.com/modelcontextprotocol/servers-archived",
    "packages": [
      {
        "registry": "npm",
        "name": "@modelcontextprotocol/server-gitlab",
        "latestVersion": "2025.4.25",
        "weeklyDownloads": 30692,
        "deprecatedNotice": "Package no longer supported. Contact Support at https://www.npmjs.com/support for more info."
      },
      {
        "registry": "docker",
        "name": "mcp/gitlab"
      }
    ],
    "replacements": [
      {
        "name": "GitLab MCP server (built into GitLab)",
        "kind": "official",
        "remoteUrl": "https://gitlab.com/api/v4/mcp",
        "how": "claude mcp add -s user --transport http GitLab https://gitlab.com/api/v4/mcp (on Self-Managed or Dedicated, use https://<your-instance>/api/v4/mcp). Then run /mcp and approve OAuth in the browser. stdio clients can use mcp-remote (Node 20+).",
        "credentials": "A GitLab account. The client gets an OAuth 2.0 token with the mcp scope through Dynamic Client Registration, or you use a fine-grained PAT with the MCP tool resource and Execute permission. Legacy personal, project and group tokens are rejected with 403. On Self-Managed, an admin must allow MCP server access. Free tier is included since 19.2. GitLab.com rate limit is 60 calls per minute on Free and 600 on Premium and Ultimate.",
        "evidence": [
          "https://docs.gitlab.com/user/gitlab_duo/model_context_protocol/mcp_server/",
          "https://docs.gitlab.com/user/model_context_protocol/mcp_server/",
          "https://about.gitlab.com/blog/mcp-server-ga/"
        ],
        "maintained": "Generally available in GitLab 19.5, published 2026-10-15 (https://about.gitlab.com/blog/mcp-server-ga/). The docs version history lists further changes in 19.6. The MCP registry lists com.gitlab/mcp with remote…"
      },
      {
        "name": "GitLab MCP Server by zereight (zereight/gitlab-mcp)",
        "kind": "alternative",
        "package": "npm:@zereight/mcp-gitlab",
        "how": "claude mcp add gitlab --transport stdio --scope local --env GITLAB_PERSONAL_ACCESS_TOKEN=\"$GITLAB_PERSONAL_ACCESS_TOKEN\" --env GITLAB_API_URL=https://gitlab.com/api/v4 -- npx -y @zereight/mcp-gitlab@latest",
        "credentials": "A GitLab personal access token plus GITLAB_API_URL, or GITLAB_USE_OAUTH=true.",
        "evidence": [
          "https://raw.githubusercontent.com/zereight/gitlab-mcp/main/README.md",
          "https://registry.npmjs.org/@zereight/mcp-gitlab",
          "https://registry.modelcontextprotocol.io/v0/servers?search=gitlab&version=latest"
        ],
        "maintained": "npm 2.3.30 published 2026-11-20 (https://registry.npmjs.org/@zereight/mcp-gitlab). Default branch HEAD committed 2026-11-19. The MCP registry lists io.github.zereight/gitlab-mcp 2.3.30, updated 2026-11-20. About 201k npm downloads last…"
      }
    ]
  },
  {
    "id": "slack",
    "server": "Slack",
    "status": "archived",
    "summary": "Archived by the MCP maintainers on 2025-05-29; every npm version is deprecated.",
    "statusEvidence": "https://github.com/modelcontextprotocol/servers-archived",
    "packages": [
      {
        "registry": "npm",
        "name": "@modelcontextprotocol/server-slack",
        "latestVersion": "2025.4.25",
        "weeklyDownloads": 183067,
        "deprecatedNotice": "Package no longer supported. Contact Support at https://www.npmjs.com/support for more info."
      },
      {
        "registry": "docker",
        "name": "mcp/slack"
      }
    ],
    "replacements": [
      {
        "name": "Slack MCP server (hosted by Slack)",
        "kind": "official",
        "remoteUrl": "https://mcp.slack.com/mcp",
        "how": "Connect an MCP client that is a Slack partner app (Claude, ChatGPT, Cursor and others) to https://mcp.slack.com/mcp over Streamable HTTP. In Claude Code, run /plugin marketplace add slackapi/slack-skills-plugin and then /plugin install slack@slack, which configures the server with Slack's own OAuth client. Neither SSE nor Dynamic Client Registration is supported.",
        "credentials": "An OAuth user token (with an optional bot token) issued through a registered Slack app with a fixed app ID. Only directory-published or internal apps may use MCP. Workspace admins can approve and manage MCP client integrations. Each tool needs its own user scopes (search:read.*, chat:write, canvases:write and so on). Unlike the old server, it does not take a pasted xoxb bot token.",
        "evidence": [
          "https://docs.slack.dev/ai/slack-mcp-server/",
          "https://docs.slack.dev/changelog/2026/02/17/slack-mcp",
          "https://slack.com/help/articles/48855576908307-Guide-to-the-Slack-MCP-server"
        ],
        "maintained": "Slack's own plugin repo slackapi/slack-skills-plugin, whose .mcp.json points at https://mcp.slack.com/mcp, was pushed on 2026-11-18. Plugin v1.8.0 was released 2026-11-17 (https://docs.slack.dev/changelog/2026/11/17/slack-skills-plugin).…"
      }
    ],
    "note": "The MCP maintainers' README says \"Now maintained by Zencoder\", but @zencoderai/slack-mcp-server has a single version (0.0.1, July 2025) and no commits since, so it is not listed."
  },
  {
    "id": "sentry",
    "server": "Sentry",
    "status": "archived",
    "summary": "Archived by the MCP maintainers on 2025-05-29.",
    "statusEvidence": "https://github.com/modelcontextprotocol/servers-archived",
    "packages": [
      {
        "registry": "pypi",
        "name": "mcp-server-sentry",
        "latestVersion": "2025.1.14",
        "weeklyDownloads": 1332
      },
      {
        "registry": "docker",
        "name": "mcp/sentry"
      }
    ],
    "replacements": [
      {
        "name": "Sentry MCP (getsentry/sentry-mcp, now shown as getsentry/toolkit)",
        "kind": "official",
        "package": "npm:@sentry/mcp-server",
        "remoteUrl": "https://mcp.sentry.dev/mcp",
        "how": "Remote: add https://mcp.sentry.dev/mcp and sign in with OAuth, or send the header 'Authorization: Sentry-Bearer <token>'. Local stdio (also for self-hosted Sentry): claude mcp add sentry -- sentry mcp (Sentry CLI), or npx @sentry/mcp-server@latest with SENTRY_AUTH_TOKEN, plus SENTRY_URL or SENTRY_HOST for self-hosted. The npm package needs Node 22.15 or later.",
        "credentials": "Sentry OAuth for the remote server, or a Sentry user auth token for stdio. In stdio mode, the AI-powered search tools need an LLM provider key (OpenAI, Azure OpenAI, Anthropic or OpenRouter). Without one, the other tools still work.",
        "evidence": [
          "https://raw.githubusercontent.com/getsentry/sentry-mcp/main/README.md",
          "https://github.com/getsentry/sentry-mcp",
          "https://registry.npmjs.org/@sentry/mcp-server"
        ],
        "maintained": "@sentry/mcp-server 0.50.0 published 2026-11-18 (https://registry.npmjs.org/@sentry/mcp-server). Default branch HEAD committed 2026-11-20. The MCP registry lists io.github.getsentry/sentry-mcp 0.50.0 with remote https://mcp.sentry.dev/mcp,…"
      }
    ]
  },
  {
    "id": "brave-search",
    "server": "Brave Search",
    "status": "archived",
    "summary": "Archived by the MCP maintainers; their README says it \"has been replaced by the official server\".",
    "statusEvidence": "https://github.com/modelcontextprotocol/servers",
    "packages": [
      {
        "registry": "npm",
        "name": "@modelcontextprotocol/server-brave-search",
        "latestVersion": "0.6.2",
        "weeklyDownloads": 26774,
        "deprecatedNotice": "Package no longer supported. Contact Support at https://www.npmjs.com/support for more info."
      }
    ],
    "replacements": [
      {
        "name": "Brave Search MCP Server (brave/brave-search-mcp-server)",
        "kind": "official",
        "package": "npm:@brave/brave-search-mcp-server",
        "how": "npx -y @brave/brave-search-mcp-server with BRAVE_API_KEY set. Uses stdio by default; an HTTP transport is also available. (The mcp/brave-search Docker image lags the npm release.)",
        "credentials": "A Brave Search API key (BRAVE_API_KEY or BRAVE_API_KEY_FILE) from https://api-dashboard.search.brave.com/app/keys",
        "evidence": [
          "https://raw.githubusercontent.com/modelcontextprotocol/servers/main/README.md",
          "https://raw.githubusercontent.com/brave/brave-search-mcp-server/main/README.md",
          "https://registry.modelcontextprotocol.io/v0/servers?search=brave&version=latest"
        ],
        "maintained": "Release v2.2.0 published 2026-11-19 and marked Latest (https://github.com/brave/brave-search-mcp-server/releases/tag/v2.2.0). npm 2.2.0 published 2026-11-19. The MCP registry lists io.github.brave/brave-search-mcp-server 2.2.0, updated…"
      }
    ]
  },
  {
    "id": "postgres",
    "server": "PostgreSQL",
    "status": "archived",
    "summary": "Archived by the MCP maintainers on 2025-05-29; every npm version is deprecated.",
    "statusEvidence": "https://github.com/modelcontextprotocol/servers-archived",
    "packages": [
      {
        "registry": "npm",
        "name": "@modelcontextprotocol/server-postgres",
        "latestVersion": "0.6.2",
        "weeklyDownloads": 147218,
        "deprecatedNotice": "Archived and unmaintained; no security guarantees. See https://github.com/modelcontextprotocol/servers-archived"
      },
      {
        "registry": "docker",
        "name": "mcp/postgres"
      }
    ],
    "replacements": [
      {
        "name": "DBHub (bytebase/dbhub)",
        "kind": "alternative",
        "package": "npm:@bytebase/dbhub",
        "how": "npx -y @bytebase/dbhub@latest --dsn \"postgresql://user:pass@host:5432/db\". Your existing postgresql:// URL works unchanged. DBHub can write by default. To keep the old read-only behaviour, pass --config with a TOML file that sets readonly = true on execute_sql. Needs Node >= 22.5.",
        "credentials": "A Postgres connection string (database user and password). Use a least-privilege read-only role. No vendor account needed.",
        "evidence": [
          "https://github.com/bytebase/dbhub",
          "https://registry.npmjs.org/@bytebase/dbhub",
          "https://registry.modelcontextprotocol.io/v0/servers?search=dbhub&version=latest"
        ],
        "maintained": "npm 2.0.1 published 2026-11-20 (https://registry.npmjs.org/@bytebase/dbhub). Last push to bytebase/dbhub was 2026-11-20. 169,354 npm downloads in the last week."
      },
      {
        "name": "MCP Toolbox for Databases (googleapis/mcp-toolbox)",
        "kind": "alternative",
        "package": "npm:@toolbox-sdk/server",
        "how": "npx -y @toolbox-sdk/server --prebuilt=postgres --stdio, with env POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DATABASE, POSTGRES_USER, POSTGRES_PASSWORD. The prebuilt execute_sql runs any single statement (not read-only), so connect with a read-only role.",
        "credentials": "Postgres host, user and password via env vars. Google credentials are only needed for Cloud SQL or AlloyDB sources, not plain Postgres.",
        "evidence": [
          "https://github.com/googleapis/mcp-toolbox",
          "https://github.com/googleapis/mcp-toolbox/releases",
          "https://registry.npmjs.org/@toolbox-sdk/server"
        ],
        "maintained": "v1.17.0 released 2026-11-13 and marked Latest (https://github.com/googleapis/mcp-toolbox/releases; npm 1.17.0 also published 2026-11-13). Last push 2026-11-20."
      },
      {
        "name": "pgEdge Postgres MCP Server (pgEdge/pgedge-postgres-mcp)",
        "kind": "alternative",
        "how": "Download the v1.1.0 binary from GitHub Releases, or docker pull ghcr.io/pgedge/postgres-mcp:latest. Run it as a stdio command with env PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD (or pass -config with a YAML file). Read-only by default. Supports PostgreSQL 14 and later.",
        "credentials": "Postgres connection details (database user and password). An LLM API key is only needed for pgEdge's optional natural-language agent or clients, not for the MCP server.",
        "evidence": [
          "https://github.com/pgEdge/pgedge-postgres-mcp",
          "https://github.com/pgEdge/pgedge-postgres-mcp/releases",
          "https://registry.modelcontextprotocol.io/v0/servers?search=postgres&version=latest"
        ],
        "maintained": "v1.1.0 released 2026-09-04 and marked Latest. v1.2.0-beta1 released 2026-11-11 (https://github.com/pgEdge/pgedge-postgres-mcp/releases). Last push 2026-11-16."
      }
    ],
    "note": "Unlike the old read-only server, these can write unless configured; connect with a read-only role."
  },
  {
    "id": "sqlite",
    "server": "SQLite",
    "status": "archived",
    "summary": "Archived by the MCP maintainers on 2025-05-29; PyPI marks the project archived.",
    "statusEvidence": "https://github.com/modelcontextprotocol/servers-archived",
    "packages": [
      {
        "registry": "pypi",
        "name": "mcp-server-sqlite",
        "latestVersion": "2025.4.25",
        "weeklyDownloads": 9536
      },
      {
        "registry": "docker",
        "name": "mcp/sqlite"
      }
    ],
    "replacements": [
      {
        "name": "DBHub (bytebase/dbhub)",
        "kind": "alternative",
        "package": "npm:@bytebase/dbhub",
        "how": "npx -y @bytebase/dbhub@latest --dsn \"sqlite:///absolute/path/to/file.db\" (use sqlite:///./file.db for a relative path). It can write by default; set readonly = true on execute_sql through --config TOML if you need read-only. Needs Node >= 22.5.",
        "credentials": "None. You only need a path to the SQLite file.",
        "evidence": [
          "https://github.com/bytebase/dbhub",
          "https://registry.npmjs.org/@bytebase/dbhub",
          "https://registry.modelcontextprotocol.io/v0/servers?search=dbhub&version=latest"
        ],
        "maintained": "npm 2.0.1 published 2026-11-20. Last push 2026-11-20."
      },
      {
        "name": "MCP Toolbox for Databases (googleapis/mcp-toolbox)",
        "kind": "alternative",
        "package": "npm:@toolbox-sdk/server",
        "how": "npx -y @toolbox-sdk/server --prebuilt=sqlite --stdio with env SQLITE_DATABASE=/path/to/file.db. The prebuilt config provides execute_sql and list_tables.",
        "credentials": "None. You only need a path to the SQLite file.",
        "evidence": [
          "https://github.com/googleapis/mcp-toolbox",
          "https://github.com/googleapis/mcp-toolbox/releases",
          "https://registry.npmjs.org/@toolbox-sdk/server"
        ],
        "maintained": "v1.17.0 released 2026-11-13 and marked Latest. Last push 2026-11-20."
      }
    ]
  },
  {
    "id": "redis",
    "server": "Redis",
    "status": "archived",
    "summary": "Archived by the MCP maintainers on 2025-05-29; npm deprecates both versions.",
    "statusEvidence": "https://github.com/modelcontextprotocol/servers-archived",
    "packages": [
      {
        "registry": "npm",
        "name": "@modelcontextprotocol/server-redis",
        "latestVersion": "2025.4.25",
        "weeklyDownloads": 3375,
        "deprecatedNotice": "Package no longer supported. Contact Support at https://www.npmjs.com/support for more info."
      },
      {
        "registry": "docker",
        "name": "mcp/redis"
      }
    ],
    "replacements": [
      {
        "name": "Redis MCP Server (redis/mcp-redis)",
        "kind": "official",
        "package": "pypi:redis-mcp-server",
        "how": "uvx --from redis-mcp-server@latest redis-mcp-server --url redis://localhost:6379/0 (use rediss:// for TLS). Docker alternative: the mcp/redis image.",
        "credentials": "A Redis URL, with username and password if ACLs are on. Entra ID is optional for Azure Managed Redis.",
        "evidence": [
          "https://github.com/redis/mcp-redis",
          "https://redis.io/docs/latest/integrate/redis-mcp/",
          "https://pypi.org/pypi/redis-mcp-server/json"
        ],
        "maintained": "PyPI 0.5.1 uploaded 2026-08-05 (https://pypi.org/pypi/redis-mcp-server/json; tag 0.5.1). Last push to redis/mcp-redis was 2026-11-11. The official MCP registry lists io.github.redis/mcp-redis 0.5.1."
      }
    ]
  },
  {
    "id": "aws-kb-retrieval",
    "server": "AWS Knowledge Base Retrieval",
    "status": "archived",
    "summary": "Archived by the MCP maintainers on 2025-05-29; the npm package is deprecated.",
    "statusEvidence": "https://github.com/modelcontextprotocol/servers-archived",
    "packages": [
      {
        "registry": "npm",
        "name": "@modelcontextprotocol/server-aws-kb-retrieval",
        "latestVersion": "0.6.2",
        "weeklyDownloads": 126,
        "deprecatedNotice": "Package no longer supported. Contact Support at https://www.npmjs.com/support for more info."
      },
      {
        "registry": "docker",
        "name": "mcp/aws-kb-retrieval-server"
      }
    ],
    "replacements": [
      {
        "name": "Amazon Bedrock Knowledge Base Retrieval MCP Server (awslabs/mcp)",
        "kind": "official",
        "package": "pypi:awslabs.bedrock-kb-retrieval-mcp-server",
        "how": "uvx awslabs.bedrock-kb-retrieval-mcp-server@latest with env AWS_PROFILE and AWS_REGION (optional: KB_INCLUSION_TAG_KEY, BEDROCK_KB_RERANKING_ENABLED). The server only sees knowledge bases tagged mcp-multirag-kb=true, unless you change the tag key.",
        "credentials": "AWS credentials (profile) with Bedrock Knowledge Bases list, describe and retrieve permissions. Reranking also needs bedrock:Rerank and bedrock:InvokeModel.",
        "evidence": [
          "https://github.com/awslabs/mcp/tree/main/src/bedrock-kb-retrieval-mcp-server",
          "https://github.com/awslabs/mcp",
          "https://pypi.org/pypi/awslabs.bedrock-kb-retrieval-mcp-server/json"
        ],
        "maintained": "PyPI 1.1.3 uploaded 2026-11-17. Last push to awslabs/mcp was 2026-11-20. The awslabs/mcp README does not mark it deprecated, although Kendra and Q Business are marked deprecated in the same table."
      },
      {
        "name": "AWS MCP Server, managed remote (aws/agent-toolkit-for-aws)",
        "kind": "official",
        "remoteUrl": "https://aws-mcp.us-east-1.api.aws/mcp",
        "how": "Add the remote URL with OAuth, e.g. claude mcp add aws-mcp https://aws-mcp.us-east-1.api.aws/mcp --transport http. Or use SigV4 through uvx mcp-proxy-for-aws-cli@latest https://aws-mcp.us-east-1.api.aws/mcp --metadata AWS_REGION=<region>. There is no dedicated KB tool: the agent calls the bedrock-agent-runtime Retrieve API through aws___run_script (sandboxed Python with AWS API access).",
        "credentials": "An AWS account, with either OAuth (the AWSMCPSignInOAuthAccessPolicy policy attached) or SigV4 credentials from the AWS CLI. The IAM principal needs bedrock:Retrieve on the knowledge base.",
        "evidence": [
          "https://github.com/aws/agent-toolkit-for-aws",
          "https://docs.aws.amazon.com/agent-toolkit/latest/userguide/getting-started-aws-mcp-server.html",
          "https://docs.aws.amazon.com/agent-toolkit/latest/userguide/understanding-mcp-server-tools.html"
        ],
        "maintained": "Last push to aws/agent-toolkit-for-aws was 2026-11-20. AWS docs list 8 regional endpoints. The AWS README says the Agent Toolkit for AWS \"is the successor to\" the AWS Labs MCP servers."
      }
    ]
  },
  {
    "id": "puppeteer",
    "server": "Puppeteer",
    "status": "archived",
    "summary": "Archived by the MCP maintainers on 2025-05-29; every npm version is deprecated.",
    "statusEvidence": "https://github.com/modelcontextprotocol/servers-archived",
    "packages": [
      {
        "registry": "npm",
        "name": "@modelcontextprotocol/server-puppeteer",
        "latestVersion": "2025.5.12",
        "weeklyDownloads": 27283,
        "deprecatedNotice": "Archived and unmaintained; no security guarantees. See https://github.com/modelcontextprotocol/servers-archived"
      },
      {
        "registry": "docker",
        "name": "mcp/puppeteer"
      }
    ],
    "replacements": [
      {
        "name": "Chrome DevTools MCP (ChromeDevTools/chrome-devtools-mcp)",
        "kind": "official",
        "package": "npm:chrome-devtools-mcp",
        "how": "npx -y chrome-devtools-mcp@latest (stdio; needs Node and Google Chrome or Chrome for Testing)",
        "credentials": "None",
        "evidence": [
          "https://raw.githubusercontent.com/puppeteer/puppeteer/main/README.md",
          "https://github.com/ChromeDevTools/chrome-devtools-mcp",
          "https://registry.npmjs.org/chrome-devtools-mcp"
        ],
        "maintained": "npm 1.13.0 published 2026-11-11 (https://registry.npmjs.org/chrome-devtools-mcp); last commit 2026-11-20 (https://github.com/ChromeDevTools/chrome-devtools-mcp/commit/eb9b030280e028df0b33a1d8721349002b3cf18f); 2,264,902 downloads last week"
      },
      {
        "name": "Playwright MCP (microsoft/playwright-mcp)",
        "kind": "alternative",
        "package": "npm:@playwright/mcp",
        "how": "npx @playwright/mcp@latest (stdio; drives Chromium, Firefox or WebKit through Playwright)",
        "credentials": "None",
        "evidence": [
          "https://github.com/microsoft/playwright-mcp",
          "https://registry.npmjs.org/@playwright/mcp",
          "https://registry.modelcontextprotocol.io/v0/servers?search=playwright&version=latest"
        ],
        "maintained": "npm 0.0.86 published 2026-11-18 (https://registry.npmjs.org/@playwright/mcp); last commit 2026-11-18 (https://github.com/microsoft/playwright-mcp/commit/2337aff0213d28db41d3e3daf48cee19b3d0bd82); 11,283,200 downloads last week"
      }
    ],
    "note": "Neither replacement is a drop-in: tool names differ from puppeteer_navigate and friends."
  },
  {
    "id": "google-drive",
    "server": "Google Drive",
    "status": "archived",
    "summary": "Archived by the MCP maintainers on 2025-05-29; the npm package is deprecated.",
    "statusEvidence": "https://github.com/modelcontextprotocol/servers-archived",
    "packages": [
      {
        "registry": "npm",
        "name": "@modelcontextprotocol/server-gdrive",
        "latestVersion": "2025.1.14",
        "weeklyDownloads": 4882,
        "deprecatedNotice": "Package no longer supported. Contact Support at https://www.npmjs.com/support for more info."
      },
      {
        "registry": "docker",
        "name": "mcp/gdrive"
      }
    ],
    "replacements": [
      {
        "name": "Google Drive MCP server (Google Workspace remote MCP, drivemcp.googleapis.com)",
        "kind": "official",
        "remoteUrl": "https://drivemcp.googleapis.com/mcp/v1",
        "how": "Remote MCP at https://drivemcp.googleapis.com/mcp/v1. Enable drive.googleapis.com and drivemcp.googleapis.com in a Google Cloud project, create an OAuth 2.0 Web client marked 'Use this client for an AI-powered agent', and add the server to your MCP host.",
        "credentials": "Google Cloud project, OAuth 2.0 client (scopes drive.readonly / drive.file) and, per the setup guide, membership in the Google Workspace Developer Preview Program",
        "evidence": [
          "https://developers.google.com/workspace/guides/configure-mcp-servers",
          "https://developers.google.com/workspace/drive/api/reference/mcp",
          "https://workspaceupdates.googleblog.com/2026/05/agent-tools-and-security-updates-for-workspace-developers.html"
        ],
        "maintained": "The setup guide was last updated 2026-11-19 UTC (https://developers.google.com/workspace/guides/configure-mcp-servers). The Drive MCP reference was last updated 2026-07-16 UTC."
      },
      {
        "name": "Google Workspace MCP (taylorwilsdon/google_workspace_mcp)",
        "kind": "alternative",
        "package": "pypi:workspace-mcp",
        "how": "export GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=...; uvx workspace-mcp --tools drive (stdio, or streamable HTTP with OAuth 2.1)",
        "credentials": "Your own Google Cloud OAuth client ID and secret",
        "evidence": [
          "https://github.com/taylorwilsdon/google_workspace_mcp",
          "https://pypi.org/pypi/workspace-mcp/json",
          "https://registry.modelcontextprotocol.io/v0/servers?search=workspace&version=latest"
        ],
        "maintained": "PyPI 2.6.0 uploaded 2026-11-19 (https://pypi.org/pypi/workspace-mcp/json); release commit 2026-11-19 (https://github.com/taylorwilsdon/google_workspace_mcp/commit/21ad3daa6562ee09c6f39ab6a8b0e9150c449c69)"
      }
    ],
    "note": "Google's Drive MCP is a Developer Preview."
  },
  {
    "id": "google-maps",
    "server": "Google Maps",
    "status": "archived",
    "summary": "Archived by the MCP maintainers on 2025-05-29; the npm package is deprecated.",
    "statusEvidence": "https://github.com/modelcontextprotocol/servers-archived",
    "packages": [
      {
        "registry": "npm",
        "name": "@modelcontextprotocol/server-google-maps",
        "latestVersion": "0.6.2",
        "weeklyDownloads": 12754,
        "deprecatedNotice": "Package no longer supported. Contact Support at https://www.npmjs.com/support for more info."
      },
      {
        "registry": "docker",
        "name": "mcp/google-maps"
      }
    ],
    "replacements": [
      {
        "name": "Maps Experience agent tools (formerly Maps Grounding Lite), Google Maps Platform",
        "kind": "official",
        "remoteUrl": "https://mapstools.googleapis.com/mcp",
        "how": "Remote MCP (Streamable HTTP) at https://mapstools.googleapis.com/mcp. Enable the service in a Google Cloud project, then send an API key in the X-Goog-Api-Key header or use OAuth with the maps-platform.mapstools scope.",
        "credentials": "Google Cloud project with the service enabled, plus a Maps Platform API key or OAuth. Billable beyond the free tier: Essentials costs $7 per 1,000 requests after the first 10,000.",
        "evidence": [
          "https://developers.google.com/maps/ai/grounding-lite",
          "https://developers.google.com/maps/ai/grounding-lite/release-notes",
          "https://registry.modelcontextprotocol.io/v0/servers?search=com.googleapis&version=latest"
        ],
        "maintained": "Release notes dated 2026-11-11 (search_along_route added, Pro options GA) and 2026-10-28 (rebrand); page last updated 2026-11-11 UTC (https://developers.google.com/maps/ai/grounding-lite/release-notes)"
      },
      {
        "name": "Google Maps MCP (cablate/mcp-google-map)",
        "kind": "alternative",
        "package": "npm:@cablate/mcp-google-map",
        "how": "npx -y @cablate/mcp-google-map --stdio with GOOGLE_MAPS_API_KEY in env (without --stdio it starts an HTTP server).",
        "credentials": "Google Maps Platform API key (GOOGLE_MAPS_API_KEY)",
        "evidence": [
          "https://github.com/cablate/mcp-google-map",
          "https://registry.npmjs.org/@cablate/mcp-google-map"
        ],
        "maintained": "npm 0.0.69 published 2026-09-26 (https://registry.npmjs.org/@cablate/mcp-google-map); 1,330 downloads last week"
      }
    ]
  },
  {
    "id": "everart",
    "server": "EverArt",
    "status": "archived",
    "summary": "Archived by the MCP maintainers on 2025-05-29; the npm package is deprecated.",
    "statusEvidence": "https://github.com/modelcontextprotocol/servers-archived",
    "packages": [
      {
        "registry": "npm",
        "name": "@modelcontextprotocol/server-everart",
        "latestVersion": "0.6.2",
        "weeklyDownloads": 93,
        "deprecatedNotice": "Package no longer supported. Contact Support at https://www.npmjs.com/support for more info."
      },
      {
        "registry": "docker",
        "name": "mcp/everart"
      }
    ],
    "replacements": [],
    "note": "No maintained MCP server exists for EverArt and no maintained fork of the reference code was found. EverArt's API itself still answers."
  },
  {
    "id": "gmail-gongrzhe",
    "server": "Gmail MCP (GongRzhe)",
    "status": "archived",
    "summary": "The repository was archived by its owner on 2026-03-03. npm shows no deprecation, so npx users get no warning.",
    "statusEvidence": "https://github.com/GongRzhe/Gmail-MCP-Server",
    "packages": [
      {
        "registry": "npm",
        "name": "@gongrzhe/server-gmail-autoauth-mcp",
        "latestVersion": "1.1.11",
        "weeklyDownloads": 17527
      },
      {
        "registry": "npm",
        "name": "@gongrzhe/server-gmail-mcp",
        "latestVersion": "0.0.8",
        "weeklyDownloads": 21
      },
      {
        "registry": "npm",
        "name": "@gongrzhe/server-gmail-mcp-cloud",
        "latestVersion": "0.0.3",
        "weeklyDownloads": 12
      }
    ],
    "replacements": [
      {
        "name": "Gmail MCP server (Google Workspace remote MCP, gmailmcp.googleapis.com)",
        "kind": "official",
        "remoteUrl": "https://gmailmcp.googleapis.com/mcp/v1",
        "how": "Remote MCP at https://gmailmcp.googleapis.com/mcp/v1. Enable gmail.googleapis.com and gmailmcp.googleapis.com in a Google Cloud project and use an OAuth 2.0 Web client. It can draft but not send.",
        "credentials": "Google Cloud project, OAuth 2.0 client (scopes gmail.readonly, gmail.compose, gmail.modify) and, per the setup guide, membership in the Google Workspace Developer Preview Program",
        "evidence": [
          "https://developers.google.com/workspace/guides/configure-mcp-servers",
          "https://developers.google.com/workspace/gmail/api/reference/mcp",
          "https://workspaceupdates.googleblog.com/2026/05/agent-tools-and-security-updates-for-workspace-developers.html"
        ],
        "maintained": "The setup guide was last updated 2026-11-19 UTC. The Gmail MCP reference was last updated 2026-07-21 UTC (https://developers.google.com/workspace/gmail/api/reference/mcp)."
      },
      {
        "name": "Gmail MCP Server, maintained fork (ArtyMcLabin/Gmail-MCP-Server)",
        "kind": "fork",
        "package": "npm:@artymclabin/gmail-mcp",
        "how": "Put gcp-oauth.keys.json in place, run npx @artymclabin/gmail-mcp auth, then use npx @artymclabin/gmail-mcp as the stdio server (drop-in for @gongrzhe/server-gmail-autoauth-mcp)",
        "credentials": "Your own Google Cloud OAuth client (gcp-oauth.keys.json) for the Gmail API",
        "evidence": [
          "https://github.com/ArtyMcLabin/Gmail-MCP-Server",
          "https://registry.npmjs.org/@artymclabin/gmail-mcp",
          "https://registry.modelcontextprotocol.io/v0/servers?search=gmail&version=latest"
        ],
        "maintained": "npm 1.2.4 published 2026-11-01 (https://registry.npmjs.org/@artymclabin/gmail-mcp); release commit 2026-11-01 (https://github.com/ArtyMcLabin/Gmail-MCP-Server/commit/adf8b57e163f2d92af9eccc0a36db62159bab774); 1,157 downloads last week"
      },
      {
        "name": "gmail-mcp, hardened fork (klodr/gmail-mcp)",
        "kind": "fork",
        "package": "npm:@klodr/gmail-mcp",
        "how": "Put gcp-oauth.keys.json at ~/.gmail-mcp/, run npx -y @klodr/gmail-mcp auth --scopes=gmail.readonly (add scopes as needed), then use npx -y @klodr/gmail-mcp as the stdio server",
        "credentials": "Your own Google Cloud OAuth client (gcp-oauth.keys.json) for the Gmail API",
        "evidence": [
          "https://github.com/klodr/gmail-mcp",
          "https://registry.npmjs.org/@klodr/gmail-mcp"
        ],
        "maintained": "npm 3.0.1 published 2026-11-16 (https://registry.npmjs.org/@klodr/gmail-mcp); last commit 2026-11-16 (https://github.com/klodr/gmail-mcp/commit/8636099713c89627c2199c0fab2c366d6a11b104); 857 downloads last week"
      }
    ],
    "note": "Google's Gmail MCP can draft but not send. Both forks name GongRzhe's project as their origin and contain its last commit."
  },
  {
    "id": "office-word",
    "server": "Office Word MCP (GongRzhe)",
    "status": "archived",
    "summary": "The repository was archived by its owner on 2026-03-03; PyPI shows no deprecation.",
    "statusEvidence": "https://github.com/GongRzhe/Office-Word-MCP-Server",
    "packages": [
      {
        "registry": "pypi",
        "name": "office-word-mcp-server",
        "latestVersion": "1.1.11",
        "weeklyDownloads": 18018
      }
    ],
    "replacements": [
      {
        "name": "KitchenSink4Word (KitchenSink4AI/KitchenSink4Word)",
        "kind": "alternative",
        "package": "pypi:kitchensink4word",
        "how": "claude mcp add word -s user -- uvx kitchensink4word. Windows only, Python 3.12+. Editing .docx files works without Word installed; live editing, PDF and compare need Microsoft Word.",
        "credentials": "none",
        "evidence": [
          "https://github.com/KitchenSink4AI/KitchenSink4Word",
          "https://pypi.org/pypi/kitchensink4word/json",
          "https://registry.modelcontextprotocol.io/v0/servers?search=word&version=latest"
        ],
        "maintained": "PyPI 3.0.1 uploaded 2026-10-25 (https://pypi.org/pypi/kitchensink4word/json)"
      },
      {
        "name": "Safe Docx (UseJunior/safe-docx)",
        "kind": "alternative",
        "package": "npm:@usejunior/safe-docx",
        "how": "npm install --global @usejunior/safe-docx, then claude mcp add safe-docx -- /absolute/path/to/safe-docx. Cross-platform, Node 18+. Its tools read, search, edit, format, comment and compare existing .docx files, with tracked-changes output. Its tool reference lists no create-document tool.",
        "credentials": "none",
        "evidence": [
          "https://github.com/UseJunior/safe-docx",
          "https://raw.githubusercontent.com/UseJunior/safe-docx/main/packages/docx-mcp/docs/tool-reference.generated.md",
          "https://registry.npmjs.org/@usejunior/safe-docx"
        ],
        "maintained": "npm 0.25.1 published 2026-11-11 (https://registry.npmjs.org/@usejunior/safe-docx)"
      },
      {
        "name": "docx4j-mcp (plutext/docx4j-mcp)",
        "kind": "alternative",
        "package": "docker:ghcr.io/plutext/docx4j-mcp",
        "how": "docker run -i --rm -v /path/to/documents:/data ghcr.io/plutext/docx4j-mcp, or java -jar docx4j-mcp.jar --root /path/to/documents (JDK 17+). Cross-platform. It reads, converts and fills .docx, and builds styled .docx from Markdown (markdown_to_docx).",
        "credentials": "none",
        "evidence": [
          "https://github.com/plutext/docx4j-mcp",
          "https://github.com/plutext/docx4j-mcp/releases",
          "https://registry.modelcontextprotocol.io/v0/servers?search=docx&version=latest"
        ],
        "maintained": "Release v0.2.0 on 2026-09-08. The release page shows \"08 Sep\" without a year; the MCP registry updatedAt is 2026-09-08 (https://github.com/plutext/docx4j-mcp/releases)."
      }
    ],
    "note": "No maintained cross-platform drop-in exists; check each alternative's platform requirements."
  },
  {
    "id": "office-powerpoint",
    "server": "Office PowerPoint MCP (GongRzhe)",
    "status": "archived",
    "summary": "The repository was archived by its owner on 2026-03-03; PyPI shows no deprecation.",
    "statusEvidence": "https://github.com/GongRzhe/Office-PowerPoint-MCP-Server",
    "packages": [
      {
        "registry": "pypi",
        "name": "office-powerpoint-mcp-server",
        "latestVersion": "2.0.7",
        "weeklyDownloads": 13757
      }
    ],
    "replacements": [
      {
        "name": "PowerPoint MCP Server (sbroenne/mcp-server-powerpoint)",
        "kind": "alternative",
        "package": "npm:@sbroenne/mcp-server-powerpoint",
        "how": "npx -y @sbroenne/mcp-server-powerpoint@latest, or the VS Code extension sbroenne.powerpoint-mcp. Windows only, and Microsoft PowerPoint 2016+ must be installed (COM).",
        "credentials": "none",
        "evidence": [
          "https://raw.githubusercontent.com/sbroenne/mcp-server-powerpoint/main/README.md",
          "https://registry.npmjs.org/@sbroenne/mcp-server-powerpoint",
          "https://registry.modelcontextprotocol.io/v0/servers?search=powerpoint&version=latest"
        ],
        "maintained": "npm 0.3.4 published 2026-10-24 (https://registry.npmjs.org/@sbroenne/mcp-server-powerpoint)"
      },
      {
        "name": "MCP Office pptmcp (dosev-ai/mcp-office)",
        "kind": "alternative",
        "package": "pypi:mcp-office",
        "how": "pip install mcp-office, then run python -m pptmcp.server as the MCP command. Windows 10/11, Python 3.11+. Office is needed for COM tools; the read-only pptx tools work without it. Do NOT pip install the unrelated 'excelmcp' package.",
        "credentials": "none",
        "evidence": [
          "https://github.com/dosev-ai/mcp-office",
          "https://pypi.org/pypi/mcp-office/json",
          "https://registry.modelcontextprotocol.io/v0/servers?search=office-powerpoint&version=latest"
        ],
        "maintained": "PyPI 0.7.0 uploaded 2026-06-15, its only release (https://pypi.org/pypi/mcp-office/json)"
      }
    ],
    "note": "Both alternatives are Windows-only."
  },
  {
    "id": "excel-negokaz",
    "server": "Excel MCP Server (negokaz)",
    "status": "stale",
    "summary": "Not archived, but no commit or release since 2025-07-19.",
    "statusEvidence": "https://github.com/negokaz/excel-mcp-server",
    "packages": [
      {
        "registry": "npm",
        "name": "@negokaz/excel-mcp-server",
        "latestVersion": "0.12.0",
        "weeklyDownloads": 4678
      }
    ],
    "replacements": [
      {
        "name": "Excel MCP Server (haris-musa/excel-mcp-server)",
        "kind": "alternative",
        "package": "pypi:excel-mcp-server",
        "how": "claude mcp add excel --scope user -- uvx excel-mcp-server stdio --allow-dir /path/to/workbooks. Remote alternative: uvx excel-mcp-server streamable-http --allow-dir /srv/workbooks. Cross-platform, no Microsoft Excel needed.",
        "credentials": "none",
        "evidence": [
          "https://raw.githubusercontent.com/haris-musa/excel-mcp-server/main/README.md",
          "https://pypi.org/pypi/excel-mcp-server/json",
          "https://registry.modelcontextprotocol.io/v0/servers?search=excel-mcp-server&version=latest"
        ],
        "maintained": "PyPI 2.3.3 uploaded 2026-11-20; 2.3.1 and 2.3.2 the same week (https://pypi.org/pypi/excel-mcp-server/json). pypistats last_week 48418."
      },
      {
        "name": "Excel MCP Server (sbroenne/mcp-server-excel)",
        "kind": "alternative",
        "package": "npm:@sbroenne/mcp-server-excel",
        "how": "npx -y @sbroenne/mcp-server-excel (bin mcp-excel), the NuGet package Sbroenne.ExcelMcp.McpServer, or the VS Code extension sbroenne.excel-mcp. Requires Windows, Microsoft Excel 2016+ and an interactive session. Drives real Excel over COM.",
        "credentials": "none",
        "evidence": [
          "https://raw.githubusercontent.com/sbroenne/mcp-server-excel/main/README.md",
          "https://registry.npmjs.org/@sbroenne/mcp-server-excel",
          "https://registry.modelcontextprotocol.io/v0/servers?search=excel&version=latest"
        ],
        "maintained": "npm 2.6.13 published 2026-11-19 (https://registry.npmjs.org/@sbroenne/mcp-server-excel)"
      }
    ],
    "note": "haris-musa covers file editing on every OS; sbroenne drives live Excel on Windows."
  },
  {
    "id": "shrimp-task-manager",
    "server": "Shrimp Task Manager",
    "status": "stale",
    "summary": "Not archived; last npm release 2025-07-06, last commit 2025-08-21.",
    "statusEvidence": "https://github.com/cjo4m06/mcp-shrimp-task-manager",
    "packages": [
      {
        "registry": "npm",
        "name": "mcp-shrimp-task-manager",
        "latestVersion": "1.0.21",
        "weeklyDownloads": 184
      }
    ],
    "replacements": [
      {
        "name": "Backlog.md (MrLesk/Backlog.md)",
        "kind": "alternative",
        "package": "npm:backlog.md",
        "how": "npm i -g backlog.md (or brew install backlog-md), then claude mcp add backlog --scope user -- backlog mcp start. Tasks live as Markdown files in the repo. The CLI is the default agent path and MCP is optional.",
        "credentials": "none",
        "evidence": [
          "https://raw.githubusercontent.com/MrLesk/Backlog.md/main/README.md",
          "https://registry.npmjs.org/backlog.md"
        ],
        "maintained": "npm 1.55.3 published 2026-10-23; 39389 downloads last week (https://registry.npmjs.org/backlog.md)"
      }
    ]
  },
  {
    "id": "mcp-installer",
    "server": "MCP Installer (anaisbetts)",
    "status": "stale",
    "summary": "Not archived, but no commit or npm release since 2024-11-26.",
    "statusEvidence": "https://github.com/anaisbetts/mcp-installer",
    "packages": [
      {
        "registry": "npm",
        "name": "@anaisbetts/mcp-installer",
        "latestVersion": "0.5.0",
        "weeklyDownloads": 231
      }
    ],
    "replacements": [
      {
        "name": "add-mcp (neon-solutions/add-mcp)",
        "kind": "alternative",
        "package": "npm:add-mcp",
        "how": "npx add-mcp <npm-package-or-remote-URL> [-g] to write the server into Claude Desktop, Claude Code, Cursor, VS Code and others; npx add-mcp find <name> searches its registry. It is a CLI, not an MCP server.",
        "credentials": "None (the installed server may need its own keys, passed with --env or --header)",
        "evidence": [
          "https://github.com/neon-solutions/add-mcp",
          "https://registry.npmjs.org/add-mcp"
        ],
        "maintained": "npm 2.6.1 published 2026-11-01 (https://registry.npmjs.org/add-mcp); 484,704 downloads last week"
      },
      {
        "name": "Docker MCP Toolkit: Dynamic MCP (docker/mcp-gateway)",
        "kind": "alternative",
        "how": "Docker Desktop 4.50+ with MCP Toolkit on, and your client connected to the Docker MCP Gateway. The agent then calls mcp-find and mcp-add to search for and add servers mid-conversation (docker mcp feature enable dynamic-tools if it is off).",
        "credentials": "None for the gateway itself. Servers it adds may need their own secrets (mcp-config-set).",
        "evidence": [
          "https://docs.docker.com/ai/mcp-catalog-and-toolkit/dynamic-mcp/",
          "https://github.com/docker/mcp-gateway"
        ],
        "maintained": "Tag v0.44.3 on 2026-10-26; last commit 2026-11-19 (https://github.com/docker/mcp-gateway/commit/4b5180c5ba8e1b456c53b36b7f90f17964131a16)"
      }
    ],
    "note": "add-mcp is a CLI, not an MCP server; Docker's Dynamic MCP is MCP-native."
  },
  {
    "id": "mcp-chrome",
    "server": "Chrome MCP Server (hangwin)",
    "status": "stale",
    "summary": "Not archived; no commit on master since 2026-01-06.",
    "statusEvidence": "https://github.com/hangwin/mcp-chrome",
    "packages": [
      {
        "registry": "npm",
        "name": "mcp-chrome-bridge",
        "latestVersion": "1.0.31",
        "weeklyDownloads": 936
      }
    ],
    "replacements": [
      {
        "name": "Chrome DevTools MCP (ChromeDevTools/chrome-devtools-mcp)",
        "kind": "official",
        "package": "npm:chrome-devtools-mcp",
        "how": "npx -y chrome-devtools-mcp@latest --autoConnect. This attaches to your running Chrome (M144+) after you enable remote debugging at chrome://inspect/#remote-debugging. It uses the default profile and all its open windows. Alternatively use --browser-url=http://127.0.0.1:9222, or omit both flags to launch a fresh Chrome.",
        "credentials": "none; it exposes your browser session content to the MCP client",
        "evidence": [
          "https://github.com/ChromeDevTools/chrome-devtools-mcp",
          "https://raw.githubusercontent.com/ChromeDevTools/chrome-devtools-mcp/main/docs/advanced-usage.md",
          "https://developer.chrome.com/blog/chrome-devtools-mcp"
        ],
        "maintained": "npm 1.13.0 published 2026-11-11; about 2.26M downloads last week (https://registry.npmjs.org/chrome-devtools-mcp)"
      },
      {
        "name": "Playwright MCP with browser extension (microsoft/playwright-mcp)",
        "kind": "alternative",
        "package": "npm:@playwright/mcp",
        "how": "npx @playwright/mcp@latest --extension, with the Playwright extension installed in Chrome or Edge. It connects to existing tabs and your logged-in sessions; --profile-dir-name picks the profile.",
        "credentials": "none",
        "evidence": [
          "https://raw.githubusercontent.com/microsoft/playwright-mcp/main/README.md",
          "https://registry.npmjs.org/@playwright/mcp"
        ],
        "maintained": "npm 0.0.86 published 2026-11-18 (https://registry.npmjs.org/@playwright/mcp)"
      }
    ]
  },
  {
    "id": "whatsapp-lharries",
    "server": "WhatsApp MCP (lharries)",
    "status": "stale",
    "summary": "Not archived; no code change since 2025-04-06 and no releases.",
    "statusEvidence": "https://github.com/lharries/whatsapp-mcp",
    "packages": [],
    "replacements": [
      {
        "name": "mcp-whatsapp-web (mario-andreschak/mcp-whatsapp-web)",
        "kind": "alternative",
        "package": "npm:mcp-whatsapp-web",
        "how": "npx mcp-whatsapp-web (Node 22+). The default whatsapp-web.js backend drives Chrome or Edge via Puppeteer; an optional Baileys backend runs without a browser. Link your personal account by QR or pairing code. Supports stdio and streamable HTTP.",
        "credentials": "A personal WhatsApp account linked as a device. Its README warns that automating WhatsApp without the Business API violates WhatsApp's Terms and accounts may be restricted.",
        "evidence": [
          "https://github.com/mario-andreschak/mcp-whatsapp-web",
          "https://registry.npmjs.org/mcp-whatsapp-web",
          "https://github.com/lharries/whatsapp-mcp/forks?include=active&page=1&period=&sort_by=stargazer_counts"
        ],
        "maintained": "npm 1.2.0 published 2026-09-05 (https://registry.npmjs.org/mcp-whatsapp-web). The forks page shows the repo updated 2026-11-11."
      },
      {
        "name": "WhatsApp Business Tools MCP (Meta)",
        "kind": "official",
        "remoteUrl": "https://mcp.facebook.com/whatsapp_business_tools",
        "how": "Add the remote MCP URL https://mcp.facebook.com/whatsapp_business_tools and sign in with a Meta developer account (OAuth). Beta with gradual rollout. It sets up the WhatsApp Business Platform (accounts, phone numbers, templates, webhooks) and can send_message from a registered business number. It does NOT read personal chats, so it is not a drop-in replacement.",
        "credentials": "Meta developer account (OAuth), MANAGE access to a business, admin of a WhatsApp-enabled app, and accepted ToS. Free-form messages only inside the 24-hour customer-service window.",
        "evidence": [
          "https://developers.facebook.com/documentation/mcp/whatsapp-business-tools-mcp",
          "https://developers.facebook.com/blog/post/2026/09/15/whatsapp-business-messaging-mcp-ai-agent/"
        ],
        "maintained": "Launched 2026-09-15 per the Meta for Developers blog. Docs say it is in beta and rolling out gradually."
      }
    ],
    "note": "Meta's official server is for the WhatsApp Business Platform and does not read personal chats. Automating a personal account may break WhatsApp's terms."
  }
];

const normalise = (registry: string, name: string) => (registry === "pypi" ? name.toLowerCase().replace(/[-_.]+/g, "-") : name.toLowerCase());

/** The curated row for one npm or PyPI package, if it is a known abandoned server. */
export function abandonedServerFor(registry: "npm" | "pypi", name: string): AbandonedServer | null {
  const key = normalise(registry, name);
  return ABANDONED_SERVERS.find((s) => s.packages.some((p) => p.registry === registry && normalise(registry, p.name) === key)) ?? null;
}

export function abandonedServerById(id: string): AbandonedServer | null {
  return ABANDONED_SERVERS.find((s) => s.id === id) ?? null;
}
