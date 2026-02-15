import { createCallOutputRouter } from './router.mjs';
import { createCallOutputService } from './service.mjs';

export const createCallOutputModule = ({ historyLimit } = {}) => {
  const service = createCallOutputService({ historyLimit });
  return {
    service,
    router: createCallOutputRouter({ service }),
  };
};
