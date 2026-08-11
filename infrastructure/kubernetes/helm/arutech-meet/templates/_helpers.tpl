{{- define "arutech-meet.fullname" -}}
{{ .Release.Name }}
{{- end -}}

{{- define "arutech-meet.labels" -}}
app.kubernetes.io/part-of: arutech-meet
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{- define "arutech-meet.selectorLabels" -}}
app.kubernetes.io/name: {{ include "arutech-meet.fullname" . }}-{{ .component }}
{{- end -}}
