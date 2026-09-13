import { app, processNotificationDeliveries } from './app.js';
import { config } from './config.js';

app.listen(config.apiPort, () => {
  console.log(`Clinic appointment API running at http://localhost:${config.apiPort}`);
  void processNotificationDeliveries();
  setInterval(() => void processNotificationDeliveries(), 5 * 60_000).unref();
});
