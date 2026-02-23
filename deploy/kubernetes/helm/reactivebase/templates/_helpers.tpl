{{- define "reactivebase.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "reactivebase.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "reactivebase.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
app.kubernetes.io/name: {{ include "reactivebase.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "reactivebase.selectorLabels" -}}
app.kubernetes.io/name: {{ include "reactivebase.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "reactivebase.databaseUrl" -}}
{{- if .Values.config.databaseUrl }}
{{- .Values.config.databaseUrl }}
{{- else if .Values.postgresql.enabled }}
postgresql://postgres:{{ .Values.postgresql.auth.postgresPassword }}@{{ include "reactivebase.fullname" . }}-postgresql:5432/{{ .Values.postgresql.auth.database }}
{{- end }}
{{- end }}

{{- define "reactivebase.redisUrl" -}}
{{- if .Values.config.redisUrl }}
{{- .Values.config.redisUrl }}
{{- else if .Values.redis.enabled }}
redis://{{ include "reactivebase.fullname" . }}-redis-master:6379
{{- end }}
{{- end }}
