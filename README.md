# MeshyGrab Backend

Backend API for **MeshyGrab**, a browser extension that helps users download their generated Meshy 3D models as GLB files while providing a simple free-download allowance and, eventually, an optional unlimited subscription.

---

## 🚀 What is MeshyGrab?

[Meshy](https://www.meshy.ai/) is an AI-powered 3D generation platform that allows users to create 3D models from prompts and images.

Meshy provides generated model assets through its web application, but the workflow for obtaining the final GLB model can be inconvenient for users who simply want to download and keep their generated models.

**MeshyGrab** was created to provide a cleaner download experience through a browser extension.

The extension detects the model information available to the user's Meshy workspace and allows the user to download the generated GLB file directly.

The backend exists to handle the parts that should not live entirely inside the extension:

* Installation registration
* Download entitlement
* Free-download limits
* Download consumption
* Duplicate-request protection
* Subscription state
* Persistent usage data
* Abuse protection
* Future Stripe subscription management

The actual GLB download remains client-side so users do not have to wait for the backend before their model download starts.

---

# 🎯 The Problem

The extension needs a way to enforce a simple usage model:

```text
Free user
    ↓
2 free model downloads
    ↓
Limit reached
    ↓
Upgrade
    ↓
Unlimited downloads
```

A naive implementation could keep the download counter entirely inside Chrome Storage.

However, client-only accounting has obvious problems:

* Storage can be cleared.
* Extension data can be reset.
* Multiple extension instances can disagree about usage.
* Users can potentially manipulate local state.
* There is no persistent server-side source of truth.
* Future subscription state cannot be reliably synchronized.

At the same time, making the backend part of the actual model-download path would create a poor user experience.

For example:

```text
User clicks Download
        ↓
Extension waits for API
        ↓
Backend wakes up
        ↓
Database query
        ↓
Response
        ↓
Only then start GLB download
```

That introduces unnecessary latency.

The user should receive their model immediately.

---

# 💡 The Solution

MeshyGrab uses a **hybrid client/server architecture**.

Chrome Storage provides fast local state for the extension.

The backend provides persistent server-side entitlement and usage accounting.

```text
                MeshyGrab Extension
                       │
          ┌────────────┴────────────┐
          │                         │
    Chrome Storage             Fastify API
          │                         │
    Instant local state       Persistent state
          │                         │
          │                     Drizzle ORM
          │                         │
          │                    Neon PostgreSQL
          │                         │
          │               ┌─────────┼─────────┐
          │               │         │         │
          │             users  subscriptions downloads
          │
          └────── GLB download happens locally
```

The extension can therefore:

1. Show the user's current entitlement immediately from local cache.
2. Synchronize with the backend in the background.
3. Start the GLB download without waiting unnecessarily.
4. Notify the backend that a download has been consumed.
5. Reconcile local state with the authoritative server response.

This gives us both:

**Speed + persistent accounting.**

---

# 🧱 Tech Stack

## Runtime

* Node.js
* TypeScript

## Web Framework

* Fastify

## Database

* PostgreSQL
* Neon

## ORM

* Drizzle ORM

## Database Driver

The backend uses Neon's serverless PostgreSQL driver with the Drizzle `neon-serverless` integration.

This is important because the download-consumption logic requires PostgreSQL transactions.

The HTTP-only Neon driver does not support the transaction API used by this backend.

## Future Payments

* Stripe

The database already contains subscription-related structures so Stripe can be added without redesigning the core entitlement architecture.

---

# 📁 Project Structure

```text
src/
├── config/
│   ├── constants.ts
│   ├── env.ts
│   └── errors.ts
│
├── db/
│   ├── client.ts
│   └── schema.ts
│
├── routes/
│   ├── health.ts
│   ├── install.ts
│   ├── entitlement.ts
│   └── downloads.ts
│
├── schemas/
│   ├── install.ts
│   ├── entitlement.ts
│   └── downloads.ts
│
├── services/
│   ├── entitlement.ts
│   └── downloads.ts
│
└── server.ts
```

---

# 🧠 Client vs Backend Responsibilities

MeshyGrab deliberately separates responsibilities.

## Chrome Extension

Responsible for:

* Meshy interaction
* Detecting available model information
* Starting GLB downloads
* Chrome Storage
* Cached entitlement state
* User interface
* Background synchronization

## Backend

Responsible for:

* Installation registration
* Persistent entitlement
* Free-download accounting
* Idempotency
* Subscription state
* Abuse protection
* Persistent usage records

## PostgreSQL

Responsible for:

* Persistent data
* Atomic counters
* Unique constraints
* Transactions
* Subscription records
* Download records

---

# 🚀 Intended Download UX

The intended frontend architecture is:

```text
User opens extension
        ↓
Read cached entitlement immediately
        ↓
Render UI immediately
        ↓
Background entitlement synchronization
        ↓
Update Chrome Storage
```

When the user clicks Download:

```text
                DOWNLOAD
                    │
            ┌───────┴────────┐
            │                │
      Local entitlement   GLB download
          check              starts
            │                │
            │                │
            └───────┬────────┘
                    │
                    ▼
          POST /downloads/consume
                    │
                    ▼
             Backend accounting
                    │
                    ▼
            Update local cache
```

The backend request therefore does not unnecessarily block the user's actual model download.

---

# 🔐 Security Principles

MeshyGrab follows several simple principles:

### Server-side entitlement

The authoritative free-download count lives in PostgreSQL.

### Local cache is not the source of truth

Chrome Storage is used for speed, not authoritative accounting.

### Unique installation IDs

Each extension installation gets a unique UUID.

### Idempotent consumption

Repeated requests with the same `downloadId` do not consume multiple credits.

### Atomic counters

PostgreSQL performs the free-download increment atomically.

### Transactions

Download accounting and event recording are performed transactionally.

### Rate limiting

Public endpoints are protected against excessive requests.

### Minimal data collection

The backend does not require invasive browser fingerprinting as the primary identity mechanism.

---

# ⚙️ Environment Variables

Create a `.env` file for local development.

Example:

```env
DATABASE_URL=your_neon_database_url
NODE_ENV=development
PORT=3000
```

Never commit `.env` to Git.

Use:

```text
.env
```

inside `.gitignore`.

For production, provide environment variables through the hosting provider.

---

# 🛠️ Local Development

Install dependencies:

```bash
npm install
```

Start development:

```bash
npm run dev
```

The API will run locally on:

```text
http://localhost:3000
```

Health check:

```bash
curl http://localhost:3000/health
```

---

# 🗃️ Database

The project uses Drizzle ORM for the PostgreSQL schema.

After changing the schema, apply the changes using the project's configured Drizzle database command.

For example:

```bash
npm run db:push
```

The exact database commands are defined in `package.json`.

---

# 💰 Pricing Philosophy

The initial plan is intentionally simple:

```text
Free
────
2 model downloads

Pro
────
$0.99 / month
Unlimited downloads
```

The goal is to keep the product frictionless and inexpensive while the user base is small.

Pricing can evolve later based on:

* Infrastructure costs
* Stripe fees
* Usage
* User demand
* Product value

The backend architecture is designed so pricing changes do not require changing the core download accounting system.

---

# 🧭 Current Architecture

```text
                         ┌─────────────────────┐
                         │    Meshy Web App    │
                         └──────────┬──────────┘
                                    │
                              Model generated
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │  MeshyGrab Chrome   │
                         │     Extension      │
                         └──────────┬──────────┘
                                    │
                  ┌─────────────────┴─────────────────┐
                  │                                   │
                  ▼                                   ▼
          Chrome Storage                        Fastify API
          (fast cache)                              │
                                                    │
                                               Drizzle ORM
                                                    │
                                                    ▼
                                             Neon PostgreSQL
                                                    │
                            ┌───────────────────────┼───────────────────────┐
                            │                       │                       │
                            ▼                       ▼                       ▼
                          users               downloads              subscriptions
                                                                            │
                                                                            │
                                                                       Stripe
                                                                        later
```

---

# 🏁 Project Status

## Backend

```text
✅ Fastify server
✅ TypeScript
✅ Neon PostgreSQL
✅ Drizzle ORM
✅ Environment configuration
✅ Centralized constants
✅ Centralized error codes
✅ Request validation
✅ Rate limiting
✅ Structured logging
✅ Global error handling
✅ Installation registration
✅ Installation IDs
✅ Entitlement API
✅ Free-download accounting
✅ Atomic download consumption
✅ Idempotent download events
✅ PostgreSQL transactions
✅ Persistent download records
✅ Subscription database structure
✅ Health endpoint
```

## Payments

```text
⬜ Stripe Checkout
⬜ Stripe customer creation
⬜ Stripe subscriptions
⬜ Stripe webhooks
⬜ Subscription synchronization
⬜ Pro entitlement
```

---

# 🎯 Design Philosophy

MeshyGrab follows a simple philosophy:

> **Keep the user-facing path fast. Keep the authoritative state on the server.**

The extension should feel instant.

The backend should be reliable.

PostgreSQL should enforce the important rules.

Chrome Storage should provide speed, not authority.

And Stripe should eventually handle payments without becoming entangled with the model-download path.

---

# 🤝 Contributing

MeshyGrab is currently under active development.

The backend is public primarily to document the architecture and development of the service.

Pull requests, suggestions, bug reports, and architectural discussions are welcome.

---

# 📄 License

Add the project's chosen license here.

For example:

```text
MIT License
```

if the repository is intended to be open-source under MIT.

---

# ❤️ Built with TypeScript

Built with:

**TypeScript · Fastify · Drizzle ORM · Neon · PostgreSQL · Stripe**

**MeshyGrab — simple model downloads, without the friction.** 🚀
