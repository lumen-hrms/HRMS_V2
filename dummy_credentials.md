# Lumen HRMS — test credentials

Local dev / testing accounts only. This file lives outside the `HRMS_V2` git
repo on purpose — never copy it into the repo or commit it.

Sign in at http://localhost:5173 with the **domain** (company subdomain),
**email** and **password**.

## Clients created by hand

### Redbull Racing — domain `redbullracing`

| Name | Role | Email | Password |
| --- | --- | --- | --- |
| Anuj Mankumare(Company Admin) | Company Admin | `anujm0707@gmail.com` | `Redbull@123` |
| Aarti Bhat | employee | `aarti.bhat.rbr@mailinator.com` | `Test@123` |

## Seeded demo clients (`npm run prisma:seed`)

Every account below shares the password **`Passw0rd!123`**.

| Client | Domain | Email | Role |
| --- | --- | --- | --- |
| Platform admin | — | `founder@hrms-platform.dev` | Platform Admin |
| Acme Hospitals | `acme` | `admin@acme.test` | Company Admin |
| Acme Hospitals | `acme` | `hr@acme.test` | HR Manager |
| Acme Hospitals | `acme` | `manager@acme.test` | Line Manager |
| Acme Hospitals | `acme` | `employee@acme.test` | Employee |
| Acme Hospitals | `acme` | `employee2@acme.test` | Employee |
| Acme Hospitals | `acme` | `auditor@acme.test` | Auditor |
| Beta Textiles | `beta` | `admin@beta.test` | Company Admin |
| Beta Textiles | `beta` | `hr@beta.test` | HR Manager |
| Beta Textiles | `beta` | `manager@beta.test` | Line Manager |
| Beta Textiles | `beta` | `employee@beta.test` | Employee |
| Gamma Logistics | `gamma` | `admin@gamma.test` | Company Admin |
| Gamma Logistics | `gamma` | `hr@gamma.test` | HR Manager |
| Gamma Logistics | `gamma` | `employee@gamma.test` | Employee |

## Adding a new account

Add a row under the client (or a new client section) with: name, role,
email, password, and the domain in the section heading.
