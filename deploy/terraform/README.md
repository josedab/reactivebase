# ReactiveBase Terraform Provider

Manage ReactiveBase Cloud resources with Terraform.

## Status

🚧 **Coming soon** — The Terraform provider is in development. This directory contains the resource schema specification and example configurations.

## Planned Resources

| Resource | Description |
|----------|-------------|
| `reactivebase_project` | Manage projects with plan, region |
| `reactivebase_environment` | Manage environments (staging, production) |
| `reactivebase_api_key` | Create and manage API keys |
| `reactivebase_custom_domain` | Configure custom domains with SSL |
| `reactivebase_database` | Provision Postgres databases |

## Example Configuration

```hcl
terraform {
  required_providers {
    reactivebase = {
      source  = "reactivebase/reactivebase"
      version = "~> 0.1"
    }
  }
}

provider "reactivebase" {
  api_token = var.reactivebase_token
  # Optional: api_url = "https://api.reactivebase.cloud"
}

resource "reactivebase_project" "myapp" {
  name   = "my-saas-app"
  plan   = "pro"
  region = "us-east-1"
}

resource "reactivebase_environment" "production" {
  project_id    = reactivebase_project.myapp.id
  name          = "production"
  is_production = true

  variables = {
    NODE_ENV = "production"
  }
}

resource "reactivebase_environment" "staging" {
  project_id = reactivebase_project.myapp.id
  name       = "staging"
}

resource "reactivebase_api_key" "backend" {
  project_id  = reactivebase_project.myapp.id
  name        = "backend-service"
  permissions = ["read", "write"]
}

resource "reactivebase_custom_domain" "api" {
  project_id     = reactivebase_project.myapp.id
  environment_id = reactivebase_environment.production.id
  domain         = "api.myapp.com"
}

output "api_url" {
  value = reactivebase_environment.production.url
}

output "api_key" {
  value     = reactivebase_api_key.backend.key
  sensitive = true
}
```

## Contributing

The Terraform provider will be implemented in Go using the
[terraform-plugin-framework](https://github.com/hashicorp/terraform-plugin-framework).
Contributions welcome — see the resource schemas in `schemas/` for the planned API.
