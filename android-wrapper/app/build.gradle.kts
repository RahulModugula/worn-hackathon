plugins {
    id("com.android.application")
}

android {
    namespace = "com.bedsideglance.wrapper"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.bedsideglance.wrapper"
        // MicroLumin M6 runs Android 9 (API 28).
        minSdk = 28
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
