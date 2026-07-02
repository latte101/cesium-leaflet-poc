import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// NOTE: no <React.StrictMode> on purpose. StrictMode double-invokes effects in
// dev, which would spin up two Cesium viewers / two Leaflet maps on one node.
createRoot(document.getElementById('root')).render(<App />);
