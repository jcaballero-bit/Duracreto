// ─────────────────────────────────────────────────────────────────────────────
// Seed de datos realistas · FASE 1
//
// Reproduce los 7 planteles del CLAUDE.md con su flota. La flota es 100%
// dinámica: estos números viven SOLO aquí (datos), nunca en el motor.
//
// Ejecutar:  npm run db:seed   (equivale a: tsx prisma/seed.ts)
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config"; // tsx no carga .env automáticamente (Next.js sí)
import bcrypt from "bcryptjs";
import { iniciarPg } from "../scripts/pg"; // asegura Postgres arriba antes de sembrar
import { prisma } from "@/lib/prisma"; // mismo cliente singleton que usa el motor
import { programarPedido, reordenarPedidoDia } from "@/lib/motor/asignacion";

// Marcas de mixer de ejemplo (rotan solo para dar variedad a los datos).
const MARCAS = ["Mack", "International", "Freightliner", "Kenworth"];

// Distribución de capacidades (m³) de la flota de cada plantel con flota propia.
// Cada entrada [capacidad, cantidad]. La suma de cantidades da el total del plantel.
type Distribucion = Array<[capacidad: number, cantidad: number]>;

async function crearMixers(plantelId: number, distribucion: Distribucion) {
  let contador = 0;
  const data: {
    marca: string;
    capacidad_m3: number;
    plantel_base_id: number;
    estado: string;
  }[] = [];
  for (const [capacidad, cantidad] of distribucion) {
    for (let i = 0; i < cantidad; i++) {
      data.push({
        marca: MARCAS[contador % MARCAS.length],
        capacidad_m3: capacidad,
        plantel_base_id: plantelId,
        estado: "Disponible",
      });
      contador++;
    }
  }
  await prisma.mixers.createMany({ data });
  return data.length;
}

async function crearBombas(plantelId: number, prefijo: string, cantidad: number) {
  const data = Array.from({ length: cantidad }, (_, i) => ({
    identificador: `${prefijo}-B${i + 1}`,
    estado: "Disponible",
    plantel_base_id: plantelId,
  }));
  if (data.length) await prisma.bombas.createMany({ data });
}

/** Crea un usuario con contraseña (bcrypt), roles y zona opcional. */
async function crearUsuario(
  nombre: string,
  email: string,
  password: string,
  roles: string[],
  zona: string | null = null,
) {
  return prisma.user.create({
    data: {
      name: nombre,
      email,
      passwordHash: await bcrypt.hash(password, 10),
      activo: true,
      zona,
      // Usuarios de ejemplo: no forzar cambio (para pruebas locales cómodas).
      debe_cambiar_password: false,
      roles: { create: roles.map((rol) => ({ rol })) },
    },
  });
}

async function main() {
  // SEGURIDAD: este seed BORRA todo antes de sembrar. Solo debe correr contra la BD
  // LOCAL de desarrollo. Si DATABASE_URL apunta a un host remoto (p. ej. Neon en
  // producción), se aborta — para no perder datos reales. Override consciente:
  // ALLOW_REMOTE_SEED=1 (no lo uses en producción).
  const dbUrl = process.env.DATABASE_URL ?? "";
  const esLocal =
    dbUrl === "" ||
    /@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl) ||
    dbUrl.includes(":5433");
  if (!esLocal && process.env.ALLOW_REMOTE_SEED !== "1") {
    console.error(
      "❌ db:seed BORRA todos los datos y solo debe correr en LOCAL. DATABASE_URL apunta\n" +
        "   a un host remoto. Abortado. (Para crear un admin en producción usa: npm run db:admin.)",
    );
    process.exit(1);
  }

  await iniciarPg(); // Postgres embebido arriba (idempotente)

  // Limpiar en orden de dependencias (viajes → pedidos → resto).
  await prisma.metas_asesor.deleteMany(); // ref asesores (RESTRICT) → primero
  await prisma.solicitudes_anticipadas.deleteMany(); // ref clientes (RESTRICT) → primero
  await prisma.viajes.deleteMany();
  await prisma.pedidos.deleteMany();
  await prisma.bombas.deleteMany();
  await prisma.mixers.deleteMany();
  await prisma.operadores.deleteMany();
  await prisma.plantas.deleteMany();
  await prisma.clientes.deleteMany(); // ref asesores → borrar antes
  await prisma.asesores.deleteMany(); // ref User → borrar antes que User
  await prisma.user.deleteMany(); // cascada: UserRole/Account/Session
  await prisma.disenos_mezcla.deleteMany();
  // Poner hub_id en null antes de borrar planteles para no violar la FK propia.
  await prisma.planteles.updateMany({ data: { hub_id: null } });
  await prisma.planteles.deleteMany();

  // ── HUBS DE ZONA (se crean primero porque los demás los referencian) ───────
  // Santa Marta: 2 plantas simultáneas + 19 mixers propios (hub Zona Norte).
  const santaMarta = await prisma.planteles.create({
    data: {
      nombre: "Santa Marta",
      zona: "Norte",
      capacidad_dosificacion_m3h: 95, // STALO 45 + SANY 50
      plantas: {
        create: [
          { nombre: "STALO", capacidad_m3h: 45 },
          { nombre: "SANY", capacidad_m3h: 50 },
        ],
      },
    },
  });
  // Santa Marta apunta a sí misma como hub.
  await prisma.planteles.update({
    where: { id: santaMarta.id },
    data: { hub_id: santaMarta.id },
  });

  // Tegucigalpa: 2 plantas simultáneas + 9 mixers propios (hub Zona Centro Sur).
  const tegucigalpa = await prisma.planteles.create({
    data: {
      nombre: "Tegucigalpa",
      zona: "Centro Sur",
      capacidad_dosificacion_m3h: 73, // 45 + 28
      plantas: {
        create: [
          { nombre: "Planta 1", capacidad_m3h: 45 },
          { nombre: "Planta 2", capacidad_m3h: 28 },
        ],
      },
    },
  });
  await prisma.planteles.update({
    where: { id: tegucigalpa.id },
    data: { hub_id: tegucigalpa.id },
  });

  // ── PLANTELES SIN FLOTA PROPIA / SATÉLITE ──────────────────────────────────
  // Zona Norte, préstamo desde Santa Marta.
  const choloma = await prisma.planteles.create({
    data: {
      nombre: "Choloma",
      zona: "Norte",
      capacidad_dosificacion_m3h: 28,
      hub_id: santaMarta.id,
      plantas: { create: [{ nombre: "Planta Choloma", capacidad_m3h: 28 }] },
    },
  });
  const villanueva = await prisma.planteles.create({
    data: {
      nombre: "Villanueva",
      zona: "Norte",
      capacidad_dosificacion_m3h: 28,
      hub_id: santaMarta.id,
      plantas: { create: [{ nombre: "Planta Villanueva", capacidad_m3h: 28 }] },
    },
  });
  const laCeiba = await prisma.planteles.create({
    data: {
      nombre: "La Ceiba",
      zona: "Norte",
      capacidad_dosificacion_m3h: 28,
      hub_id: santaMarta.id,
      plantas: { create: [{ nombre: "Planta La Ceiba", capacidad_m3h: 28 }] },
    },
  });
  // Puerto Cortés: 5 mixers propios + refuerzo ocasional desde Santa Marta.
  const puertoCortes = await prisma.planteles.create({
    data: {
      nombre: "Puerto Cortés",
      zona: "Norte",
      capacidad_dosificacion_m3h: 28,
      hub_id: santaMarta.id,
      plantas: { create: [{ nombre: "Planta Puerto Cortés", capacidad_m3h: 28 }] },
    },
  });

  // Zona Centro Sur, préstamo desde Tegucigalpa.
  const hazama = await prisma.planteles.create({
    data: {
      nombre: "Hazama",
      zona: "Centro Sur",
      capacidad_dosificacion_m3h: 28,
      hub_id: tegucigalpa.id,
      plantas: { create: [{ nombre: "Planta Hazama", capacidad_m3h: 28 }] },
    },
  });

  // ── FLOTA DE MIXERS (33 en total: 19 + 9 + 5) ──────────────────────────────
  // Santa Marta (19): mezcla de 11/9/7 m³.
  const nSM = await crearMixers(santaMarta.id, [
    [11, 6],
    [9, 8],
    [7, 5],
  ]);
  // Tegucigalpa (9).
  const nTGU = await crearMixers(tegucigalpa.id, [
    [11, 3],
    [9, 4],
    [7, 2],
  ]);
  // Puerto Cortés (5).
  const nPC = await crearMixers(puertoCortes.id, [
    [11, 1],
    [9, 2],
    [7, 2],
  ]);
  // Choloma, Villanueva, La Ceiba, Hazama: 0 mixers propios (dependen del hub).

  // ── BOMBAS ─────────────────────────────────────────────────────────────────
  await crearBombas(santaMarta.id, "SM", 3);
  await crearBombas(tegucigalpa.id, "TGU", 2);
  await crearBombas(puertoCortes.id, "PC", 1);
  await crearBombas(choloma.id, "CHO", 1);

  // ── OPERADORES (motoristas): uno por mixer + reserva ───────────────────────
  const todosMixers = await prisma.mixers.findMany({ orderBy: { id: "asc" } });
  let numOp = 1;
  for (const mx of todosMixers) {
    const op = await prisma.operadores.create({
      data: {
        nombre: `Motorista ${String(numOp).padStart(2, "0")}`,
        estado: "Disponible",
      },
    });
    await prisma.mixers.update({
      where: { id: mx.id },
      data: {
        operador_asignado_id: op.id,
        // Identificador de unidad de ejemplo (M-01, M-02, …); placa opcional.
        identificador: `M-${String(numOp).padStart(2, "0")}`,
      },
    });
    numOp++;
  }
  // Operadores de reserva (sin mixer fijo) para el desplegable de despacho.
  for (let i = 1; i <= 4; i++) {
    await prisma.operadores.create({
      data: { nombre: `Motorista reserva ${i}`, estado: "Disponible" },
    });
  }

  // ── DISEÑOS DE MEZCLA ────────────────────────────────────────────────────────
  const disenos = await Promise.all([
    prisma.disenos_mezcla.create({
      data: {
        codigo: "DIS-0013",
        resistencia_psi: 4000,
        etiqueta_resistencia: "4,000",
        tamano_agregado: '3/4"',
        revenimiento: "4 pulg",
        sacos_hielo_por_m3: 0,
      },
    }),
    // Diseño por flexión (MR): resistencia_psi no aplica → etiqueta "MR-600".
    prisma.disenos_mezcla.create({
      data: {
        codigo: "DIS-0018",
        resistencia_psi: null,
        etiqueta_resistencia: "MR-600",
        tamano_agregado: '1-1/2"',
        revenimiento: "2 pulg",
        sacos_hielo_por_m3: 0,
      },
    }),
    prisma.disenos_mezcla.create({
      data: {
        codigo: "DIS-0021",
        resistencia_psi: 3000,
        etiqueta_resistencia: "3,000",
        tamano_agregado: '3/4"',
        revenimiento: "5 pulg",
        sacos_hielo_por_m3: 1,
        aditivo_especial: "Retardante",
      },
    }),
  ]);

  // ── CLIENTES + RUTAS ESTÁNDAR ──────────────────────────────────────────────
  // Cliente 1 y 2 con ruta registrada; cliente 3 con ruta; cliente 4 SIN ruta
  // (para probar el marcado "ruta_por_defecto" del motor).
  const constructoraNorte = await prisma.clientes.create({
    data: {
      empresa: "W&M Constructores",
      proyecto: "Torres Platino",
      ubicacion: "San Pedro Sula",
      contacto: "Ing. Ramírez",
      telefono: "9800-0001",
      tiempo_viaje_referencia_min: 25,
      tiempo_regreso_referencia_min: 25,
    },
  });
  const inmobiliariaValle = await prisma.clientes.create({
    data: {
      empresa: "SERPIC",
      proyecto: "UNAH",
      ubicacion: "Choloma",
      contacto: "Arq. Fuentes",
      telefono: "9800-0002",
      tiempo_viaje_referencia_min: 15,
      tiempo_regreso_referencia_min: 15,
    },
  });
  const obrasCentro = await prisma.clientes.create({
    data: {
      empresa: "Obras Centro Sur",
      proyecto: "Paso a desnivel",
      ubicacion: "Tegucigalpa",
      contacto: "Ing. Andino",
      telefono: "9800-0003",
      tiempo_viaje_referencia_min: 30,
      tiempo_regreso_referencia_min: 30,
    },
  });
  const clienteSinRuta = await prisma.clientes.create({
    data: {
      empresa: "Desarrollos La Ceiba",
      proyecto: "Bodega industrial",
      ubicacion: "La Ceiba",
      contacto: "Sr. Mejía",
      telefono: "9800-0004",
      // sin ruta_estandar: el motor usará defaults marcados visualmente
    },
  });

  // ── PEDIDOS DE EJEMPLO ───────────────────────────────────────────────────
  // Se crean pasándolos por el MOTOR real (programarPedido), no insertando
  // viajes a mano: así quedan con su cascada de horarios y asignación correcta,
  // y la línea de tiempo de la interfaz se ve poblada al abrir. Cubren ambas
  // zonas y los orígenes "Flota propia" y "Préstamo de zona".
  const plantasSM = await prisma.plantas.findMany({
    where: { plantel_id: santaMarta.id },
    orderBy: { id: "asc" },
  });
  const plantaTGU = await prisma.plantas.findFirstOrThrow({
    where: { plantel_id: tegucigalpa.id },
    orderBy: { id: "asc" },
  });
  const plantaCHO = await prisma.plantas.findFirstOrThrow({
    where: { plantel_id: choloma.id },
  });
  const plantaHZ = await prisma.plantas.findFirstOrThrow({
    where: { plantel_id: hazama.id },
  });
  const bombaSM = await prisma.bombas.findFirst({
    where: { plantel_base_id: santaMarta.id },
    orderBy: { identificador: "asc" },
  });

  // Pedidos de ejemplo en el DÍA DE HOY (así el Despachador puede operarlos y el
  // Programador editarlos; la cascada se calcula igual).
  const hoy = new Date();
  const hora = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), h, m, 0, 0);
  };

  const ejemplos = [
    {
      cliente_id: constructoraNorte.id,
      diseno_id: disenos[1].id,
      volumen_total_m3: 22,
      hora_solicitada: hora("07:00"),
      plantel_id: santaMarta.id,
      planta_id: plantasSM[0].id, // STALO
      tipo_descarga: "Canal directo",
      elemento: "Losa de entrepiso",
    },
    {
      cliente_id: inmobiliariaValle.id,
      diseno_id: disenos[0].id,
      volumen_total_m3: 30,
      hora_solicitada: hora("07:30"),
      plantel_id: santaMarta.id,
      planta_id: plantasSM[1].id, // SANY
      tipo_descarga: "Bomba estacionaria",
      bomba_id: bombaSM?.id ?? null, // para mostrar el código de la bomba
      elemento: "Cimentación",
      sacos_hielo_por_m3: 3,
    },
    {
      cliente_id: inmobiliariaValle.id,
      diseno_id: disenos[0].id,
      volumen_total_m3: 20,
      hora_solicitada: hora("08:00"),
      plantel_id: choloma.id, // sin flota → préstamo de Santa Marta
      planta_id: plantaCHO.id,
      tipo_descarga: "Canal directo",
      elemento: "Muro de contención",
    },
    {
      cliente_id: obrasCentro.id,
      diseno_id: disenos[2].id,
      volumen_total_m3: 18,
      hora_solicitada: hora("07:15"),
      plantel_id: tegucigalpa.id,
      planta_id: plantaTGU.id,
      tipo_descarga: "Canal directo",
      elemento: "Columnas",
    },
    {
      cliente_id: clienteSinRuta.id, // sin ruta → tiempos por defecto (marcado)
      diseno_id: disenos[0].id,
      volumen_total_m3: 14,
      hora_solicitada: hora("08:15"),
      plantel_id: hazama.id, // sin flota → préstamo de Tegucigalpa
      planta_id: plantaHZ.id,
      tipo_descarga: "Canal directo",
      elemento: "Piso industrial",
    },
  ];

  let viajesGenerados = 0;
  const pedidoIds: number[] = [];
  for (const e of ejemplos) {
    const r = await programarPedido({ ...e, creado_por: "seed" });
    pedidoIds.push(r.pedidoId);
    viajesGenerados += r.viajes.filter((v) => v.mixerId != null).length;
  }

  // Genera una entrada real de bitácora (reordenar) para que el visor no aparezca
  // vacío en la primera carga; el registro se escribe por el flujo real del motor.
  if (pedidoIds[1]) {
    await reordenarPedidoDia(pedidoIds[1], 1, "jcaballero@duracreto.com");
  }

  // ── USUARIOS (Fase 3) ────────────────────────────────────────────────────
  await crearUsuario(
    "Jose Arturo Caballero",
    "jcaballero@duracreto.com",
    "admin123",
    ["Administrador"],
  );
  await crearUsuario(
    "Programador Norte",
    "prog.norte@duracreto.com",
    "prog123",
    ["Programador"],
    "Norte",
  );
  await crearUsuario(
    "Despachador Norte",
    "desp.norte@duracreto.com",
    "desp123",
    ["Despachador"],
    "Norte",
  );
  await crearUsuario(
    "Gerente Comercial",
    "comercial@duracreto.com",
    "comercial123",
    ["GerenteComercial"],
  );
  // Asesor comercial vinculado a un usuario + sus clientes.
  const asesorUser = await crearUsuario(
    "Ana Asesora",
    "asesor@duracreto.com",
    "asesor123",
    ["Asesor"],
  );
  const asesor = await prisma.asesores.create({
    data: {
      nombre: "Ana Asesora",
      correo: "asesor@duracreto.com",
      usuario_auth_id: asesorUser.id,
    },
  });
  await prisma.clientes.updateMany({
    where: { id: { in: [constructoraNorte.id, inmobiliariaValle.id] } },
    data: { asesor_id: asesor.id },
  });

  // Meta comercial de ejemplo para el asesor en el mes en curso.
  await prisma.metas_asesor.create({
    data: {
      asesor_id: asesor.id,
      anio: hoy.getFullYear(),
      mes: hoy.getMonth() + 1,
      meta_m3: 300,
      creado_por: "comercial@duracreto.com",
    },
  });

  // ── PROYECCIONES DE EJEMPLO (Programa Semana) ────────────────────────────
  // Proyecciones PRELIMINARES del asesor para hoy y mañana (aún no son pedidos).
  const hoyMedianoche = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const manana = new Date(hoyMedianoche);
  manana.setDate(manana.getDate() + 1);
  await prisma.solicitudes_anticipadas.createMany({
    data: [
      // W&M / Torres Platino: DOS suministros el mismo día (muros y losa).
      {
        cliente_id: constructoraNorte.id,
        asesor_id: asesor.id,
        plantel_id: santaMarta.id,
        fecha_requerida: hoyMedianoche,
        volumen_estimado_m3: 25,
        tipo_concreto_estimado: "CONCRETO 4000 3/4",
        tipo_descarga_estimado: "Bomba",
        sacos_hielo_por_m3: 3,
        elemento: "Muros",
        frecuencia_entre_camiones_min: 20,
        observaciones: "Acceso estrecho. Cliente pide llegar 6:30am.",
        creado_por: "asesor@duracreto.com",
      },
      {
        cliente_id: constructoraNorte.id,
        asesor_id: asesor.id,
        plantel_id: santaMarta.id,
        fecha_requerida: hoyMedianoche,
        volumen_estimado_m3: 30,
        tipo_concreto_estimado: "CONCRETO 5000 3/4",
        tipo_descarga_estimado: "Bomba",
        elemento: "Losa",
        creado_por: "asesor@duracreto.com",
      },
      {
        cliente_id: inmobiliariaValle.id,
        asesor_id: asesor.id,
        plantel_id: choloma.id,
        fecha_requerida: manana,
        volumen_estimado_m3: 18,
        tipo_concreto_estimado: "CONCRETO 3000 3/4",
        tipo_descarga_estimado: "Directo",
        creado_por: "asesor@duracreto.com",
      },
    ],
  });

  console.log("Seed completado:");
  console.log(`  Planteles: 7 (Norte: 5, Centro Sur: 2)`);
  console.log(
    `  Usuarios: 4 (admin jcaballero / admin123, prog.norte, desp.norte, asesor@duracreto.com / asesor123)`,
  );
  console.log(`  Mixers: ${nSM + nTGU + nPC} (SM ${nSM}, TGU ${nTGU}, PC ${nPC})`);
  console.log(`  Diseños: ${disenos.length}`);
  console.log(
    `  Clientes: 4 (${[constructoraNorte, inmobiliariaValle, obrasCentro].length} con ruta, 1 sin ruta: ${clienteSinRuta.empresa})`,
  );
  console.log(
    `  Pedidos de ejemplo: ${ejemplos.length} → ${viajesGenerados} viajes asignados`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
