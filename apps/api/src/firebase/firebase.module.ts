import { Global, Module } from '@nestjs/common';
import { firebaseAdminProvider } from './firebase-admin.provider';

/**
 * Global so every module (auth, platform-admin, common/guards) can inject
 * FIREBASE_AUTH without each declaring its own import of this module.
 */
@Global()
@Module({
  providers: [firebaseAdminProvider],
  exports: [firebaseAdminProvider],
})
export class FirebaseModule {}
