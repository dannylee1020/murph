import { startMurphServer } from '../server/app.js';
import { murphRoutes } from './routes.js';

startMurphServer({
  label: 'Murph',
  routes: murphRoutes()
});
