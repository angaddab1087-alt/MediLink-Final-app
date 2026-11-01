import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

/** Every error leaves as plain JSON with a request ID. Database and code details are logged, never returned. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private log = new Logger('Error');
  catch(e: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const requestId = randomUUID();
    if (e instanceof HttpException) {
      const body: any = e.getResponse();
      return res.status(e.getStatus()).json({ statusCode: e.getStatus(), message: typeof body === 'string' ? body : body.message, requestId });
    }
    if (['22P02', '22003', '23502', '23514'].includes(e?.code)) return res.status(400).json({ statusCode: 400, message: 'Some of the information sent is not valid.', requestId });
    if (e?.code === '23505') return res.status(409).json({ statusCode: 409, message: 'This already exists.', requestId });
    if (e?.type === 'entity.too.large') return res.status(413).json({ statusCode: 413, message: 'The upload is too large.', requestId });
    this.log.error(`${requestId} ${e?.message}`);
    return res.status(500).json({ statusCode: 500, message: 'Something went wrong on our side. Please try again.', requestId });
  }
}
