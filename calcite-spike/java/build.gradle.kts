plugins {
    java
    application
    id("com.gradleup.shadow") version "8.3.6"
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.apache.calcite:calcite-core:1.41.0")
}

java {
    // CheerpJ's most mature runtime is Java 8, and Calcite still ships
    // Java 8 bytecode, so the whole classpath stays at 8.
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

tasks.withType<JavaCompile> {
    options.release = 8
}

application {
    mainClass = "spike.SpikeMain"
}

tasks.shadowJar {
    archiveFileName = "calcite-spike.jar"
    // Calcite drags in optional integrations we don't use; trimming keeps
    // the jar (served to browsers) as small as possible.
    minimize {
        // calcite-core is looked up reflectively all over; never minimize it.
        exclude(dependency("org.apache.calcite:.*:.*"))
        exclude(dependency("org.codehaus.janino:.*:.*"))
        exclude(dependency("org.apache.calcite.avatica:.*:.*"))
    }
    mergeServiceFiles()
}
