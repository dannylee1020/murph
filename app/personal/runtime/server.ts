import { startMurphServer } from '../../../shared/server/app.js';
import { personalRoutes } from './routes.js';

startMurphServer({
  distribution: 'personal',
  label: 'Murph Personal',
  routes: personalRoutes()
});
