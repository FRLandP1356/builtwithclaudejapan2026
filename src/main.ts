import './ui/theme.css';
import { mountSite } from './site/site';

// The site (src/site/): hash routes, one message to a screen. The earlier shell of six screens (src/ui/app.ts) is kept
// as parts and tests, but is no longer the entry.
const root = document.getElementById('app');
if (root) void mountSite(root);
