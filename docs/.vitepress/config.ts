import { defineConfig } from 'vitepress';

const siteUrl = 'https://murph-agent.com';
const siteDescription = 'Local-first AI handoff agent for Slack, Discord, and async work.';
const socialPreviewUrl = `${siteUrl}/img/social-preview.png`;

export default defineConfig({
  title: 'Murph',
  description: siteDescription,
  appearance: true,
  cleanUrls: true,
  lastUpdated: true,
  sitemap: {
    hostname: siteUrl
  },
  head: [
    ['link', { rel: 'icon', href: '/img/favicon.svg' }],
    ['meta', { name: 'robots', content: 'index,follow' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'Murph' }],
    ['meta', { property: 'og:title', content: 'Murph' }],
    ['meta', { property: 'og:description', content: siteDescription }],
    ['meta', { property: 'og:url', content: siteUrl }],
    ['meta', { property: 'og:image', content: socialPreviewUrl }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'Murph' }],
    ['meta', { name: 'twitter:description', content: siteDescription }],
    ['meta', { name: 'twitter:image', content: socialPreviewUrl }],
    [
      'link',
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800;900&display=swap'
      }
    ]
  ],
  themeConfig: {
    logo: '/img/murph-logo.svg',
    siteTitle: 'Murph',
    nav: [
      { text: 'Docs', link: '/docs/quickstart' },
      { text: 'GitHub', link: 'https://github.com/dannylee1020/murph' }
    ],
    sidebar: {
      '/docs/': [
        {
          text: 'Start',
          items: [{ text: 'Quickstart', link: '/docs/quickstart' }]
        },
        {
          text: 'Installation',
          items: [
            { text: 'Install Murph', link: '/docs/installation/' },
            { text: 'Troubleshooting', link: '/docs/installation/troubleshooting' }
          ]
        },
        {
          text: 'Operate',
          items: [
            { text: 'Configuration', link: '/docs/configuration' },
            { text: 'CLI & Agent', link: '/docs/cli-agent' },
            { text: 'Core Concepts', link: '/docs/core-concepts' },
            { text: 'Channels', link: '/docs/channels' },
            { text: 'Integrations', link: '/docs/integrations' },
            { text: 'Contributing', link: '/docs/contributing' }
          ]
        },
        {
          text: 'Guides',
          items: [
            { text: 'Slack Agent', link: '/docs/slack-agent' },
            { text: 'Discord Agent', link: '/docs/discord-agent' },
            { text: 'Local-first AI Agent', link: '/docs/local-first-ai-agent' },
            { text: 'Web Search', link: '/docs/web-search' }
          ]
        }
      ]
    },
    footer: {
      message: 'Local-first handoff agent for async work.',
      copyright: `Copyright © ${new Date().getFullYear()} Murph`
    },
    outline: {
      label: 'On this page',
      level: [2, 3]
    }
  }
});
