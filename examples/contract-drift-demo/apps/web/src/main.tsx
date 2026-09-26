import { createRoot } from 'react-dom/client';
import { PerformancePage } from './pages/PerformancePage.js';

const container = document.getElementById('root');
if (!container) throw new Error('Root container is missing');
createRoot(container).render(<PerformancePage fetchImpl={fetch} />);
