// Pruebas PURAS de la extracción de coordenadas de enlaces de Google Maps.
import { describe, expect, it } from "vitest";
import {
  enlaceComoLlegar,
  enlaceVista,
  esEnlaceCorto,
  extraerCoordsDeUrl,
} from "@/lib/geo/maps-link";

describe("extraerCoordsDeUrl", () => {
  it("extrae de @lat,lng", () => {
    expect(
      extraerCoordsDeUrl("https://www.google.com/maps/@14.0818,-87.2068,15z"),
    ).toEqual({ lat: 14.0818, lng: -87.2068 });
  });

  it("extrae de q=lat,lng", () => {
    expect(
      extraerCoordsDeUrl("https://www.google.com/maps?q=14.0818,-87.2068"),
    ).toEqual({ lat: 14.0818, lng: -87.2068 });
  });

  it("extrae de ll=lat,lng", () => {
    expect(
      extraerCoordsDeUrl("https://maps.google.com/?ll=15.5041,-88.025"),
    ).toEqual({ lat: 15.5041, lng: -88.025 });
  });

  it("prioriza !3d!4d (pin exacto) sobre @ (centro del mapa)", () => {
    const url =
      "https://www.google.com/maps/place/Obra/@14.10,-87.20,17z/data=!3d14.0818!4d-87.2068";
    expect(extraerCoordsDeUrl(url)).toEqual({ lat: 14.0818, lng: -87.2068 });
  });

  it("extrae de destination= (enlace de navegación)", () => {
    expect(
      extraerCoordsDeUrl(
        "https://www.google.com/maps/dir/?api=1&destination=14.08,-87.20",
      ),
    ).toEqual({ lat: 14.08, lng: -87.2 });
  });

  it("acepta la coma codificada %2C", () => {
    expect(
      extraerCoordsDeUrl("https://www.google.com/maps?q=14.08%2C-87.20"),
    ).toEqual({ lat: 14.08, lng: -87.2 });
  });

  it("acepta marcadores codificados %21 (HTML) con orden !2d(lng)!3d(lat)", () => {
    // Formato embebido en el HTML de Maps: %211d…%212d<lng>%213d<lat>
    const html = "foo%211d30757.79%212d-87.9886336%213d15.4041bar";
    expect(extraerCoordsDeUrl(html)).toEqual({ lat: 15.4041, lng: -87.9886336 });
  });

  it("prioriza !3d!4d sobre !2d!3d cuando ambos aparecen", () => {
    const url = "…!2d-87.20!3d14.05…/data=!3d14.0818!4d-87.2068";
    expect(extraerCoordsDeUrl(url)).toEqual({ lat: 14.0818, lng: -87.2068 });
  });

  it("devuelve null si no hay coordenadas (enlace corto o texto)", () => {
    expect(extraerCoordsDeUrl("https://maps.app.goo.gl/abc123")).toBeNull();
    expect(extraerCoordsDeUrl("https://www.google.com/maps?q=Tegucigalpa")).toBeNull();
    expect(extraerCoordsDeUrl("")).toBeNull();
    expect(extraerCoordsDeUrl(null)).toBeNull();
  });

  it("rechaza coordenadas fuera de rango o (0,0)", () => {
    expect(extraerCoordsDeUrl("https://www.google.com/maps?q=999,999")).toBeNull();
    expect(extraerCoordsDeUrl("https://www.google.com/maps?q=0,0")).toBeNull();
  });
});

describe("esEnlaceCorto", () => {
  it("reconoce maps.app.goo.gl y goo.gl/maps", () => {
    expect(esEnlaceCorto("https://maps.app.goo.gl/abc")).toBe(true);
    expect(esEnlaceCorto("https://goo.gl/maps/xyz")).toBe(true);
  });
  it("no marca un enlace largo como corto", () => {
    expect(esEnlaceCorto("https://www.google.com/maps/@14.08,-87.20,15z")).toBe(false);
    expect(esEnlaceCorto(null)).toBe(false);
  });
});

describe("armado de enlaces", () => {
  it("enlaceVista", () => {
    expect(enlaceVista(14.08, -87.2)).toBe("https://www.google.com/maps?q=14.08,-87.2");
  });
  it("enlaceComoLlegar", () => {
    expect(enlaceComoLlegar(14.08, -87.2)).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=14.08,-87.2",
    );
  });
});
