FROM golang:1.23-alpine AS build

ARG VERSION=dev
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . ./
RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags "-s -w -X main.version=${VERSION}" \
    -o /out/crate-readplane \
    ./cmd/crate-readplane

FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=build /out/crate-readplane /crate-readplane

EXPOSE 8686
ENTRYPOINT ["/crate-readplane"]
