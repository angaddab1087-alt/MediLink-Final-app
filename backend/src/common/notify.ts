import { Db } from '../db/db.service';
export async function notify(db: Db, userId: number, title: string, body: string) {
  await db.q('INSERT INTO notifications (user_id, title, body) VALUES ($1,$2,$3)', [userId, title, body]);
}
