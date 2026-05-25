import { defineConfig } from 'vitepress';

const siteUrl = 'https://murph-agent.com';
const siteDescription =
    'Local-first handoff agent for staying offline without losing context.';
const socialPreviewUrl = `${siteUrl}/img/social-preview.png`;

export default defineConfig({
    title: 'Murph',
    description: siteDescription,
    appearance: true,
    cleanUrls: true,
    lastUpdated: true,
    sitemap: {
        hostname: siteUrl,
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
                href: 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800;900&display=swap',
            },
        ],
    ],
    themeConfig: {
        logo: '/img/murph-logo.svg',
        siteTitle: 'Murph',
        nav: [
            { text: 'Docs', link: '/docs/quickstart' },
            { text: 'GitHub', link: 'https://github.com/dannylee1020/murph' },
        ],
        sidebar: {
            '/docs/': [
                {
                    text: 'Getting Started',
                    collapsed: false,
                    items: [
                        { text: 'Quickstart', link: '/docs/quickstart' },
                        { text: 'Install Murph', link: '/docs/installation/' },
                        {
                            text: 'Troubleshooting',
                            link: '/docs/installation/troubleshooting',
                        },
                    ],
                },
                {
                    text: 'Core',
                    collapsed: false,
                    items: [
                        { text: 'Core Concepts', link: '/docs/core-concepts' },
                        { text: 'Configuration', link: '/docs/configuration' },
                        { text: 'Memory', link: '/docs/memory' },
                        { text: 'Policy', link: '/docs/policy' },
                        { text: 'Integrations', link: '/docs/integrations' },
                    ],
                },
                {
                    text: 'Usage',
                    collapsed: false,
                    items: [
                        { text: 'Overview', link: '/docs/usage' },
                        {
                            text: 'Murph Agent',
                            link: '/docs/usage/murph-agent',
                        },
                        { text: 'Browser UI', link: '/docs/usage/browser-ui' },
                        { text: 'CLI', link: '/docs/usage/cli' },
                        {
                            text: 'Best Practices',
                            link: '/docs/usage/best-practices',
                        },
                    ],
                },
                {
                    text: 'Channels',
                    collapsed: false,
                    items: [
                        { text: 'Overview', link: '/docs/channels' },
                        {
                            text: 'Setup Flow',
                            link: '/docs/channels/setup-flow',
                        },
                        {
                            text: 'Watched Channels',
                            link: '/docs/channels/watched-channels',
                        },
                        { text: 'Slack', link: '/docs/channels/slack' },
                        { text: 'Discord', link: '/docs/channels/discord' },
                        {
                            text: 'Troubleshooting',
                            link: '/docs/channels/troubleshooting',
                        },
                    ],
                },
                {
                    text: 'Plugins',
                    collapsed: false,
                    items: [
                        { text: 'Overview', link: '/docs/plugins' },
                        { text: 'Channels', link: '/docs/plugins/channels' },
                        { text: 'Skills', link: '/docs/plugins/skills' },
                        {
                            text: 'Connectors',
                            link: '/docs/plugins/connectors',
                        },
                        { text: 'Tools', link: '/docs/plugins/tools' },
                        {
                            text: 'Create and Manage',
                            link: '/docs/plugins/create',
                        },
                    ],
                },
                {
                    text: 'Developing',
                    collapsed: false,
                    items: [
                        { text: 'Contributing', link: '/docs/contributing' },
                        {
                            text: 'Extending',
                            collapsed: false,
                            items: [
                                {
                                    text: 'Overview',
                                    link: '/docs/developing/extending/',
                                },
                                {
                                    text: 'Plugins',
                                    link: '/docs/developing/extending/plugins',
                                },
                                {
                                    text: 'Tools',
                                    link: '/docs/developing/extending/tools',
                                },
                                {
                                    text: 'Skills',
                                    link: '/docs/developing/extending/skills',
                                },
                                {
                                    text: 'Connectors / Integrations',
                                    link: '/docs/developing/extending/connectors',
                                },
                                {
                                    text: 'Channels',
                                    link: '/docs/developing/extending/channels',
                                },
                                {
                                    text: 'Policy',
                                    link: '/docs/developing/extending/policy',
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        footer: {
            message: 'Local-first handoff agent for async work.',
            copyright: `Copyright © ${new Date().getFullYear()} Murph`,
        },
        outline: {
            label: 'On this page',
            level: [2, 3],
        },
    },
});
