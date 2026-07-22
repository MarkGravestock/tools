plugins {
    java
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("dev.hardwood:hardwood-core:1.0.0.Final")
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

// Flat copy of the runtime classpath so build-wasm.sh can hand native-image a
// simple -cp string.
val copyDeps = tasks.register<Copy>("copyDeps") {
    from(configurations.runtimeClasspath)
    into(layout.buildDirectory.dir("dependency"))
}

tasks.register<JavaExec>("runJvm") {
    description = "Run the demo with Hardwood's threaded RowReader on the JVM"
    mainClass = "demo.JvmDemo"
    classpath = sourceSets.main.get().runtimeClasspath
}

tasks.register<JavaExec>("runSync") {
    description = "Run the wasm-compatible single-threaded reader on the JVM"
    mainClass = "demo.WasmDemo"
    classpath = sourceSets.main.get().runtimeClasspath
}

// Everything build-wasm.sh needs from Gradle in one invocation.
tasks.register("wasmPrep") {
    dependsOn(tasks.named("classes"), copyDeps)
}
