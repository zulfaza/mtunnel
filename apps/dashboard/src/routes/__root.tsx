import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import "./styles.css";

function RootDocument(): ReactNode {
  const title = "mTunnel dashboard";
  const description =
    "A small, self-hosted development tunnel for exposing localhost through Cloudflare.";
  const pageUrl = "https://app.makarima.xyz/";
  const socialImageUrl = "https://app.makarima.xyz/og.png";

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        <title>{title}</title>
        <meta content={description} name="description" />
        <meta content="noindex, nofollow" name="robots" />
        <meta content="#fbfaf8" name="theme-color" />
        <meta content="mTunnel dashboard" name="application-name" />
        <meta content="mTunnel dashboard" name="apple-mobile-web-app-title" />
        <link href={pageUrl} rel="canonical" />
        <link href="/favicon.ico" rel="icon" sizes="any" />
        <link href="/favicon.ico" rel="shortcut icon" />
        <link href="/favicon-32x32.png" rel="icon" sizes="32x32" type="image/png" />
        <link href="/favicon-16x16.png" rel="icon" sizes="16x16" type="image/png" />
        <link href="/apple-touch-icon.png" rel="apple-touch-icon" sizes="180x180" />
        <link href="/site.webmanifest" rel="manifest" />
        <meta content="website" property="og:type" />
        <meta content="mTunnel" property="og:site_name" />
        <meta content={title} property="og:title" />
        <meta content={description} property="og:description" />
        <meta content={pageUrl} property="og:url" />
        <meta content={socialImageUrl} property="og:image" />
        <meta content="mTunnel — Your localhost, on the internet." property="og:image:alt" />
        <meta content="1200" property="og:image:width" />
        <meta content="630" property="og:image:height" />
        <meta content="summary_large_image" name="twitter:card" />
        <meta content={title} name="twitter:title" />
        <meta content={description} name="twitter:description" />
        <meta content={socialImageUrl} name="twitter:image" />
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}

export const Route = createRootRoute({ component: RootDocument });
