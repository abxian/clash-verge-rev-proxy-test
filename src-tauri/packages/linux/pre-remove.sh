#!/bin/bash

. /etc/os-release

if [ "$ID" = "deepin" ]; then
    if [ -f "/usr/share/applications/shenxianyun.desktop" ]; then
        echo "Removing deepin desktop file"
        rm -vf "/usr/share/applications/shenxianyun.desktop"
    fi
fi

