import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'ReactiveBase',
  tagline: 'Convex DX on Postgres. Reactive queries, automatic transactions, built-in scheduling — on infrastructure you control.',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://reactivebase.dev',
  baseUrl: '/',

  organizationName: 'reactivebase',
  projectName: 'reactivebase',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/reactivebase/reactivebase/tree/main/website/',
        },
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'ReactiveBase',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Docs',
        },
        {to: '/blog', label: 'Blog', position: 'left'},
        {
          href: 'https://github.com/reactivebase/reactivebase',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Learn',
          items: [
            { label: 'Getting Started', to: '/docs/getting-started' },
            { label: 'Core Concepts', to: '/docs/core-concepts' },
            { label: 'API Reference', to: '/docs/api-reference' },
          ],
        },
        {
          title: 'Community',
          items: [
            { label: 'GitHub', href: 'https://github.com/reactivebase/reactivebase' },
            { label: 'Discord', href: 'https://discord.gg/reactivebase' },
          ],
        },
        {
          title: 'Compare',
          items: [
            { label: 'vs Convex', to: '/docs/compare/convex' },
            { label: 'vs Supabase', to: '/docs/compare/supabase' },
            { label: 'vs Firebase', to: '/docs/compare/firebase' },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} ReactiveBase. MIT License.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'typescript', 'sql'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
