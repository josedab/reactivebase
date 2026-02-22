import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/getting-started">
            Get Started →
          </Link>
        </div>
        <div style={{marginTop: '1rem'}}>
          <code style={{
            background: 'rgba(255,255,255,0.1)',
            padding: '0.5rem 1rem',
            borderRadius: '4px',
            fontSize: '1rem',
          }}>
            npx create-reactivebase my-app
          </code>
        </div>
      </div>
    </header>
  );
}

function FeatureCard({title, description}: {title: string; description: string}) {
  return (
    <div className="col col--4" style={{marginBottom: '2rem'}}>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout
      title="Convex DX on Postgres"
      description="Reactive queries, automatic transactions, built-in scheduling — on infrastructure you control.">
      <HomepageHeader />
      <main>
        <section style={{padding: '2rem 0'}}>
          <div className="container">
            <div className="row">
              <FeatureCard
                title="🔄 Reactive Queries"
                description="Every query is live. Subscribed clients get updates automatically when data changes. Filter-level invalidation minimizes unnecessary re-renders."
              />
              <FeatureCard
                title="🔒 Automatic Transactions"
                description="Every mutation runs in a SERIALIZABLE Postgres transaction. No partial writes, ever. Serialization conflicts retry automatically."
              />
              <FeatureCard
                title="🧠 AI-Native"
                description="Built-in vector search with pgvector. Auto-embed text with OpenAI or Ollama. Reactive semantic search that updates in real-time."
              />
              <FeatureCard
                title="🐘 Postgres-Native"
                description="Full SQL access, JSONB, PostGIS, full-text search. Your data, your database. No vendor lock-in."
              />
              <FeatureCard
                title="⏰ Built-in Scheduling"
                description="Background jobs and cron without separate infrastructure. Postgres-backed with retry and dead-letter handling."
              />
              <FeatureCard
                title="🛡️ Production-Ready"
                description="JWT auth (RS256/JWKS), middleware, Prometheus metrics, OpenTelemetry tracing, multi-tenant isolation, webhooks."
              />
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
