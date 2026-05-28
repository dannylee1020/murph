import { startMurphServer } from '../../shared/server/app.js';
import { teamRoutes } from './routes.js';

startMurphServer({
  distribution: 'team',
  label: 'Murph Team',
  routes: teamRoutes()
});
