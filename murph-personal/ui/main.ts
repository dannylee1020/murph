import '../../shared/ui/styles.css';
import { installRouter } from '../../shared/ui/app/router';
import { renderPersonal } from './render';

installRouter(renderPersonal);
