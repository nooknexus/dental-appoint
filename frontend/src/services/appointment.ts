import type { AppointmentRequest } from '../types';

/**
 * Local hand-off simulation for the public form. It intentionally does not
 * retain or display the request's personal information.
 */
export async function submitAppointmentRequest(request: AppointmentRequest): Promise<void> {
  void request;
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 320);
  });
}
