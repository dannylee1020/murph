import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Murph',
  description: 'Self-hosted async autopilot for team continuity.',
  appearance: true,
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['link', { rel: 'icon', href: '/img/favicon.svg' }],
    [
      'link',
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800;900&display=swap'
      }
    ]
  ],
  themeConfig: {
    logo: '/img/favicon.svg',
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
        }
      ]
    },
    footer: {
      message: 'Self-hosted async autopilot for team continuity.',
      copyright: `Copyright © ${new Date().getFullYear()} Murph`
    },
    outline: {
      label: 'On this page',
      level: [2, 3]
    }
  }
});
