import './ui/theme.css';
import './ui/app.css';
import { mountApp } from './ui/app';

const root = document.getElementById('app');
if (root) void mountApp(root);
