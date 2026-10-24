# MIPI cameras need libcamera's device provider and source, not raw V4L2
# capture nodes alone. The wrynose recipe includes simple/SoftISP on aarch64.
PACKAGECONFIG:append = " gst"
