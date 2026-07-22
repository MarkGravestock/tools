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
    // CheerpJ's most mature runtime is Java 8, and Calcite still ships Java 8
    // bytecode, so the whole classpath stays at 8.
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

tasks.withType<JavaCompile> {
    options.release = 8
}

application {
    mainClass = "cqe.SmokeTest"
}

tasks.shadowJar {
    // Emit straight into the tool's app/ folder, which the page (and GitHub
    // Pages) serves to the browser — so `gradle shadowJar` is the whole jar build.
    archiveFileName = "calcite-query-explainer.jar"
    destinationDirectory = file("../app")
    minimize {
        // calcite-core is looked up reflectively throughout; never minimize it
        // or its codegen/JDBC companions away.
        exclude(dependency("org.apache.calcite:.*:.*"))
        exclude(dependency("org.apache.calcite.avatica:.*:.*"))
        exclude(dependency("org.codehaus.janino:.*:.*"))
        // Used directly to parse JSON input; keep it whole (reflective databind).
        exclude(dependency("com.fasterxml.jackson.core:.*:.*"))
    }
    mergeServiceFiles()
}
