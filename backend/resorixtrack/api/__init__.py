# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 RESORIX AG
from flask_smorest import Api


def register_blueprints(api: Api) -> None:
    from . import (
        absence_routes,
        admin_routes,
        auth_routes,
        branding_routes,
        org_routes,
        report_routes,
        signoff_routes,
        time_routes,
        worklog_routes,
    )

    for mod in (auth_routes, time_routes, absence_routes, org_routes, report_routes, admin_routes, signoff_routes,
                branding_routes, worklog_routes):
        api.register_blueprint(mod.bp)
