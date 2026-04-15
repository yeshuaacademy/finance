/** @type {import('next').NextConfig} */
const INTERNAL_API_ORIGIN = process.env.INTERNAL_API_ORIGIN ?? 'http://127.0.0.1:4000';

const nextConfig = {
	output: 'standalone',
	reactStrictMode: true,
	swcMinify: true,

	// ✅ Disable type and lint checks during production builds (for Dokploy)
	typescript: {
		ignoreBuildErrors: process.env.DISABLE_TS_CHECK === '1',
	},
	eslint: {
		ignoreDuringBuilds: true,
	},

	images: {
		remotePatterns: [
			// NextJS <Image> component needs to whitelist domains for src={}
			{ protocol: 'https', hostname: 'lh3.googleusercontent.com' },
			{ protocol: 'https', hostname: 'pbs.twimg.com' },
			{ protocol: 'https', hostname: 'images.unsplash.com' },
			{ protocol: 'https', hostname: 'logos-world.net' },
			{ protocol: 'http', hostname: 'localhost' },
			{ protocol: 'https', hostname: 'localhost' },
			{ protocol: 'https', hostname: 'cdn-icons-png.flaticon.com' },
			{ protocol: 'https', hostname: 'res.cloudinary.com' },
			{ protocol: 'https', hostname: 'blogger.googleusercontent.com' },
			{ protocol: 'https', hostname: 'fast-strapi-cms-651b34b82e95.herokuapp.com' },
			{ protocol: 'https', hostname: 'secure.gravatar.com' },
			{ protocol: 'https', hostname: 'img.clerk.com' },
			{ protocol: 'http', hostname: '3.73.130.136' },
			{ protocol: 'https', hostname: '3.73.130.136' },
		],
	},
	async rewrites() {
		const apiOrigin = INTERNAL_API_ORIGIN;
		return [
			{ source: '/api/ledger', destination: `${apiOrigin}/api/ledger` },
			{ source: '/api/review', destination: `${apiOrigin}/api/review` },
			{ source: '/api/upload', destination: `${apiOrigin}/api/upload` },
			{
				source: '/api/transactions/:id/category',
				destination: `${apiOrigin}/api/transactions/:id/category`,
			},
			{ source: '/api/accounts', destination: `${apiOrigin}/api/accounts` },
			{
				source: '/api/accounts/:accountId/opening-balance',
				destination: `${apiOrigin}/api/accounts/:accountId/opening-balance`,
			},
			{
				source: '/api/opening-balances/:balanceId/lock',
				destination: `${apiOrigin}/api/opening-balances/:balanceId/lock`,
			},
			{ source: '/api/reconciliation', destination: `${apiOrigin}/api/reconciliation` },
			{
				source: '/api/ledger/:ledgerId/lock',
				destination: `${apiOrigin}/api/ledger/:ledgerId/lock`,
			},
			{
				source: '/api/ledger/:ledgerId/unlock',
				destination: `${apiOrigin}/api/ledger/:ledgerId/unlock`,
			},
			{ source: '/api/rules', destination: `${apiOrigin}/api/rules` },
			{ source: '/api/rules/:id', destination: `${apiOrigin}/api/rules/:id` },
		];
	},
};

module.exports = nextConfig;
