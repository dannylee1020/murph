import { startMurphServer } from '../../shared/server/app.js';
import { murphRoutes } from './routes.js';

startMurphServer({
  label: 'Murph',
  routes: murphRoutes()
});
